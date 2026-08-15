package com.spiritpal.desktop_pet.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import com.spiritpal.desktop_pet.R

class PetWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    override fun onEnabled(context: Context) {}
    override fun onDisabled(context: Context) {}

    companion object {
        fun updateAppWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int,
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_pet)
            val state = readPetState(context)

            views.setTextViewText(R.id.widget_pet_name, state.characterDisplayName)
            views.setTextViewText(R.id.widget_hp_text, "HP: ${state.hp}/100")
            views.setTextViewText(R.id.widget_mood_text, "mood: ${state.mood}/100")
            views.setTextViewText(R.id.widget_level_text, "Lv.${state.level}")
            views.setProgressBar(R.id.widget_hp_bar, 100, state.hp, false)
            views.setImageViewResource(R.id.widget_pet_icon, R.drawable.widget_icon_star)

            val feedIntent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("spiritpal://feed?item_id=apple")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val feedPendingIntent = android.app.PendingIntent.getActivity(
                context, 0, feedIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_btn_feed, feedPendingIntent)

            val chatIntent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("spiritpal://open_chat")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val chatPendingIntent = android.app.PendingIntent.getActivity(
                context, 1, chatIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_btn_chat, chatPendingIntent)

            val openIntent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("spiritpal://pet")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val openPendingIntent = android.app.PendingIntent.getActivity(
                context, 2, openIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_root, openPendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }

        private fun readPetState(context: Context): PetState {
            return try {
                val file = java.io.File(context.filesDir, "widget_state.json")
                if (!file.exists()) return PetState.DEFAULT
                val json = file.readText()
                parsePetState(json)
            } catch (e: Exception) {
                PetState.DEFAULT
            }
        }

        private fun parsePetState(json: String): PetState {
            return try {
                val obj = org.json.JSONObject(json)
                PetState(
                    hp = obj.optInt("hp", 70),
                    mood = obj.optInt("mood", 50),
                    level = obj.optInt("level", 1),
                    affection = obj.optInt("affection", 0),
                    coins = obj.optInt("coins", 0),
                    characterName = obj.optString("characterName", "pet"),
                    characterDisplayName = obj.optString("characterDisplayName", "Pet"),
                    characterIcon = obj.optString("characterIcon", ""),
                    lastInteraction = obj.optLong("lastInteraction", 0),
                    updatedAt = obj.optLong("updatedAt", 0),
                )
            } catch (e: Exception) {
                PetState.DEFAULT
            }
        }
    }
}

data class PetState(
    val hp: Int,
    val mood: Int,
    val level: Int,
    val affection: Int,
    val coins: Int,
    val characterName: String,
    val characterDisplayName: String,
    val characterIcon: String,
    val lastInteraction: Long,
    val updatedAt: Long,
) {
    companion object {
        val DEFAULT = PetState(
            hp = 70, mood = 50, level = 1, affection = 0, coins = 0,
            characterName = "pet", characterDisplayName = "Pet", characterIcon = "",
            lastInteraction = 0, updatedAt = 0,
        )
    }
}
