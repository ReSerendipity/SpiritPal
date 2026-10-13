import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import javax.inject.Inject
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction
import org.gradle.process.ExecOperations
import org.gradle.process.ExecSpec

/**
 * cargo-ndk 构建任务。
 *
 * 必须是 `abstract class`：通过 `@get:Inject` 让 Gradle 注入 [ExecOperations]。
 * ⚠️ 不能用 `project.exec {}`（Gradle 8 deprecated / Gradle 9.0 **已移除**，
 * 编译报 `Unresolved reference 'exec'`）；也不能用
 * `objects.newInstance(ExecOperations::class)`（Gradle 8.14 实测运行时抛
 * `Cannot have abstract method ExecOperations.exec(Action)`）—— 注入是唯一 8/9 通吃的路子。
 */
abstract class BuildTask : DefaultTask() {
    @get:Inject
    internal abstract val execOperations: ExecOperations

    @Input
    var rootDirRel: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")

        // Map the rust target arch (used by the plugin) to (Android ABI, cargo triple).
        val (abi, triple) = when (target) {
            "aarch64" -> "arm64-v8a" to "aarch64-linux-android"
            "armv7" -> "armeabi-v7a" to "armv7-linux-androideabi"
            "i686" -> "x86" to "i686-linux-android"
            "x86_64" -> "x86_64" to "x86_64-linux-android"
            else -> throw GradleException("unknown rust target: $target")
        }

        val projectDir = project.projectDir
        val workingDir = File(projectDir, rootDirRel)
        val jniLibs = File(projectDir, "src/main/jniLibs")

        val cargoHome = System.getenv("CARGO_HOME")
            ?: (System.getenv("USERPROFILE")?.let { "$it/.cargo" }
                ?: (System.getenv("HOME")?.let { "$it/.cargo" }))

        // Build only (no -o). cargo-ndk's own copy step panics on antivirus file locks
        // (ERROR_SHARING_VIOLATION), so we copy the .so ourselves with a retry loop.
        val args = mutableListOf("ndk", "-t", abi, "build")
        if (release) args.add("--release")
        if (project.logger.isEnabled(LogLevel.DEBUG)) args.add("-vv")
        else if (project.logger.isEnabled(LogLevel.INFO)) args.add("-v")

        logger.lifecycle("cargo-ndk: building $abi (release=$release)")
        // Kotlin 陷阱：buildSrc 用 `kotlin-dsl`，它为 ExecOperations.exec 加了
        // `(ExecSpec.() -> Unit)` 扩展，与 Java 的 `exec(Action)` 重载冲突 ——
        // 显式写 `Action<ExecSpec> { spec -> }` 会被判成「传给扩展」而类型不符。
        // 故这里用最朴素的 receiver lambda（与原来的 project.exec { } 同形）。
        val result = execOperations.exec {
            workingDir(workingDir)
            executable("cargo")
            args(args)
            val path = System.getenv("PATH") ?: ""
            val cargoBin = cargoHome?.let { "$it/bin" } ?: ""
            if (cargoBin.isNotEmpty() && !path.contains(cargoBin)) {
                environment("PATH", "$cargoBin;$path")
            }
            val ndk = System.getenv("ANDROID_NDK_HOME") ?: System.getenv("ANDROID_NDK_ROOT")
            if (ndk != null) environment("ANDROID_NDK_HOME", ndk)
        }
        result.assertNormalExitValue()

        // Copy the produced .so into jniLibs/<abi>/, retrying past transient antivirus
        // sharing violations (code 32: "另一个程序正在使用此文件").
        val profile = if (release) "release" else "debug"
        val src = File(File(workingDir, "target/$triple/$profile"), "libspiritpal_lib.so")
        val dstDir = File(jniLibs, abi)
        dstDir.mkdirs()
        val dst = File(dstDir, "libspiritpal_lib.so")
        if (!src.exists()) throw GradleException("built library not found: ${src.absolutePath}")
        copyWithRetry(src, dst)
        logger.lifecycle("copied ${src.name} -> ${dst.absolutePath}")
    }

    private fun copyWithRetry(src: File, dst: File, attempts: Int = 10) {
        var last: Exception? = null
        for (i in 1..attempts) {
            try {
                Files.copy(src.toPath(), dst.toPath(), StandardCopyOption.REPLACE_EXISTING)
                return
            } catch (e: Exception) {
                last = e
                if (i < attempts) {
                    logger.warn("copy attempt $i failed (${e.message}); retrying in 2s")
                    Thread.sleep(2000)
                }
            }
        }
        throw GradleException("failed to copy ${src.absolutePath} to ${dst.absolutePath}: ${last?.message}")
    }
}
