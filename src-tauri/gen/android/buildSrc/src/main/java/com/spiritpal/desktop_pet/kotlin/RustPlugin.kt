import com.android.build.api.dsl.ApplicationExtension
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.get
import java.io.File

const val TASK_GROUP = "rust"

open class Config {
    var rootDirRel: String = "../../../"
}

open class RustPlugin : Plugin<Project> {
    private lateinit var config: Config

    override fun apply(project: Project) = with(project) {
        config = extensions.create("rust", Config::class.java)

        val defaultAbiList = listOf("arm64-v8a", "armeabi-v7a", "x86", "x86_64");
        val abiList = (findProperty("abiList") as? String)?.split(',') ?: defaultAbiList

        val defaultArchList = listOf("arm64", "arm", "x86", "x86_64");
        val archList = (findProperty("archList") as? String)?.split(',') ?: defaultArchList

        val targetsList = (findProperty("targetList") as? String)?.split(',') ?: listOf("aarch64", "armv7", "i686", "x86_64")

        extensions.configure<ApplicationExtension> {
            @Suppress("UnstableApiUsage")
            flavorDimensions.add("abi")
            productFlavors {
                create("universal") {
                    dimension = "abi"
                    ndk {
                        abiFilters += abiList
                    }
                }
                defaultArchList.forEachIndexed { index, arch ->
                    create(arch) {
                        dimension = "abi"
                        ndk {
                            abiFilters.add(defaultAbiList[index])
                        }
                    }
                }
            }
        }

        afterEvaluate {
            // 前端产物与 SRI 清单必须来自同一次构建，否则不允许编译 rust 库。
            //
            // cargo（tauri-build）在编译期把 dist/ 与 src-tauri/src/generated/sri_hashes.rs
            // 一起内嵌进 .so；而 gradle 链路不会执行 tauri.conf.json 的 beforeBuildCommand。
            // 只要有人单独跑过 `npm run build`（package.json 的 build 不含 SRI 那步），
            // 两者就不同步，CSP `script-src 'self'` 下 WebView 取不到脚本，产出的 APK 会
            // 静默停在「正在启动，请稍候…」——logcat 无报错、无 ANR、无 crash，
            // 极易被误判成「debug 包冷启慢」。故在 rust 构建之前硬拦一道。
            // 绕过口：-PskipFrontendSriCheck（降级为警告，不静默）。
            // File(projectDir, "../../../") 不会归一化 ".."，其词法 parentFile 会少退一层，
            // 必须先 canonicalFile 再取 parent，否则脚本路径拼错。
            val repoRoot = File(projectDir, config.rootDirRel).canonicalFile.parentFile
            val proj = project
            val verifyScript = File(repoRoot, "scripts/obfuscate-and-sri.mjs")
            val strictFrontendSri = project.findProperty("skipFrontendSriCheck") == null
            val verifyFrontendSri = tasks.maybeCreate("verifyFrontendSri", DefaultTask::class.java)
            verifyFrontendSri.group = TASK_GROUP
            verifyFrontendSri.description = "Verify dist/assets match src-tauri/src/generated/sri_hashes.rs"
            verifyFrontendSri.doLast {
                // 门禁的失败诊断必须按签名分流：把「脚本没跑到」报成「哈希不一致」
                // 会把人往完全错误的方向推。
                if (!verifyScript.exists()) {
                    throw GradleException(
                        "verifyFrontendSri 无法执行：找不到校验脚本 ${verifyScript.absolutePath}" +
                        "（config.rootDirRel=\"${config.rootDirRel}\" 解析到 ${repoRoot?.absolutePath}）。" +
                        "这是工装接线问题，不代表 dist 与清单不一致。"
                    )
                }
                // 用 project.exec 拿 ExecResult.exitValue（Gradle 8 的 Exec 任务上不暴露该属性），
                // 与 BuildTask.kt 里 project.exec { }.assertNormalExitValue() 同一套写法。
                val result = proj.exec {
                    workingDir(repoRoot)
                    commandLine("node", verifyScript.absolutePath, "--verify")
                    isIgnoreExitValue = true
                }
                if (result.exitValue != 0) {
                    val hint = "重建配对：npm run build && node scripts/obfuscate-and-sri.mjs" +
                        "（成因见 docs/execution/android-fix-verification-20261003.md 第 4 节）"
                    if (strictFrontendSri) {
                        throw GradleException(
                            "dist 与 sri_hashes.rs 不是同一次构建的产物（或 dist 缺失）；" +
                            "继续打包会产出静默卡在启动页的 APK。$hint。" +
                            "确需绕过：加 -PskipFrontendSriCheck"
                        )
                    }
                    proj.logger.warn("已用 -PskipFrontendSriCheck 跳过 dist/SRI 校验；$hint")
                }
            }

            for (profile in listOf("debug", "release")) {
                val profileCapitalized = profile.replaceFirstChar { it.uppercase() }
                val buildTask = tasks.maybeCreate(
                    "rustBuildUniversal$profileCapitalized",
                    DefaultTask::class.java
                ).apply {
                    group = TASK_GROUP
                    description = "Build dynamic library in $profile mode for all targets"
                }

                buildTask.dependsOn(verifyFrontendSri)
                tasks.findByName("mergeUniversal${profileCapitalized}JniLibFolders")?.dependsOn(buildTask)

                for (targetPair in targetsList.withIndex()) {
                    val targetName = targetPair.value
                    val targetArch = archList[targetPair.index]
                    val targetArchCapitalized = targetArch.replaceFirstChar { it.uppercase() }
                    val targetBuildTask = project.tasks.maybeCreate(
                        "rustBuild$targetArchCapitalized$profileCapitalized",
                        BuildTask::class.java
                    ).apply {
                        group = TASK_GROUP
                        description = "Build dynamic library in $profile mode for $targetArch"
                        rootDirRel = config.rootDirRel
                        target = targetName
                        release = profile == "release"
                    }

                    buildTask.dependsOn(targetBuildTask)
                    targetBuildTask.dependsOn(verifyFrontendSri)
                    tasks.findByName("merge$targetArchCapitalized${profileCapitalized}JniLibFolders")?.dependsOn(
                        targetBuildTask
                    )
                }
            }
        }
    }
}
