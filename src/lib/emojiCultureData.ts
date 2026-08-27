/**
 * @file emojiCultureData.ts
 * @description 文化适配表情包数据集 — 中/英/日/韩四文化特色表情
 * 
 * 不同文化背景下对表情的理解差异：
 * - 中文：偏爱可爱、萌系、网络流行语表情
 * - 英文：简洁直接，常用手势和物体表情
 * - 日文：颜文字、emoji 组合、动漫风格
 * - 韩文：K-pop 影响，鲜艳色彩 + 可爱动物元素
 */

import type { Locale } from './i18nTranslations'

// ============ 类型定义 ============

export interface EmojiSet {
  /** 表情符号主标识 */
  primary: string
  /** 备选表情列表 */
  alternatives: string[]
  /** 使用场景描述 */
  context: string
  /** 情感分类 */
  category: 'happy' | 'sad' | 'angry' | 'excited' | 'calm' | 'neutral' | 'love' | 'thank' | 'surprised'
}

export interface CultureEmojiMap {
  [key: string]: {
    primary: Record<Locale, EmojiSet>
  }
}

// ============ 文化适配表情包 ============

export const CULTURE_EMOJI_MAP: CultureEmojiMap = {
  // 问候类
  greeting: {
    primary: {
      'zh-CN': {
        primary: '👋',
        alternatives: ['你好', 'Hi~', '✨'],
        context: '打招呼时的挥手动作',
        category: 'neutral',
      },
      'en-US': {
        primary: '👋',
        alternatives: ['Hey!', 'Hi there', '🌟'],
        context: 'Wave hello with hand gesture',
        category: 'neutral',
      },
      'ja-JP': {
        primary: '🙆‍♀️',
        alternatives: ['こんにちは', 'ハイ', '🌸'],
        context: 'お辞儀しながら挨拶',
        category: 'neutral',
      },
      'ko-KR': {
        primary: '👋',
        alternatives: ['안녕', '하이', '💫'],
        context: '손 흔들면서 인사',
        category: 'neutral',
      },
    },
  },

  // 开心类
  happy: {
    primary: {
      'zh-CN': {
        primary: '😊',
        alternatives: ['嘻嘻', '哈哈~', '😄', '😁'],
        context: '表达开心的笑容',
        category: 'happy',
      },
      'en-US': {
        primary: '😄',
        alternatives: ['Yay!', 'Awesome!', '🎉'],
        context: 'Express happiness and excitement',
        category: 'happy',
      },
      'ja-JP': {
        primary: 'ヾ (◍°∇°◍) ﾉﾞ',
        alternatives: ['うれしい', 'ワクワク', '✨', '🌈'],
        context: '楽しそうな顔文字',
        category: 'happy',
      },
      'ko-KR': {
        primary: '😀',
        alternatives: ['재미있어', '좋아!', '🎊'],
        context: '기뻐하는 미소',
        category: 'happy',
      },
    },
  },

  // 感谢类
  thanks: {
    primary: {
      'zh-CN': {
        primary: '🙏',
        alternatives: ['谢谢啦', '感恩', '❤️'],
        context: '双手合十表示感谢',
        category: 'thank',
      },
      'en-US': {
        primary: '🙏',
        alternatives: ['Thank you!', 'Thanks a lot!', '👍'],
        context: 'Folded hands for gratitude',
        category: 'thank',
      },
      'ja-JP': {
        primary: '🙇‍♀️',
        alternatives: ['ありがとう', '感謝', '🌺'],
        context: 'お辞儀してお礼を言う',
        category: 'thank',
      },
      'ko-KR': {
        primary: '🙏',
        alternatives: ['고마워', '감사해요', '👍'],
        context: '두 손 합치 감사 표시',
        category: 'thank',
      },
    },
  },

  // 爱心类
  love: {
    primary: {
      'zh-CN': {
        primary: '❤️',
        alternatives: ['么么哒', '爱你哦', '💕', '😘'],
        context: '表达爱意和喜爱',
        category: 'love',
      },
      'en-US': {
        primary: '❤️',
        alternatives: ['Love you!', '💖', '😍'],
        context: 'Show love and affection',
        category: 'love',
      },
      'ja-JP': {
        primary: '💕',
        alternatives: ['大好き', '愛してる', '💝', '(´▽ʃ♡ƪ)'],
        context: '心型の愛表現',
        category: 'love',
      },
      'ko-KR': {
        primary: '💗',
        alternatives: ['사랑해', '좋아', '💞'],
        context: '사랑 표현하기',
        category: 'love',
      },
    },
  },

  // 悲伤类
  sad: {
    primary: {
      'zh-CN': {
        primary: '😢',
        alternatives: ['呜呜', '好难过', '😭', 'qwq'],
        context: '表示伤心和难过',
        category: 'sad',
      },
      'en-US': {
        primary: '😔',
        alternatives: ['Sad...', 'Boo hoo', '😢'],
        context: 'Express sadness or disappointment',
        category: 'sad',
      },
      'ja-JP': {
        primary: 'T_T',
        alternatives: ['悲しい', '泣きたい', '😿', '(；ω；)'],
        context: '悲しみの涙',
        category: 'sad',
      },
      'ko-KR': {
        primary: '😢',
        alternatives: ['슬퍼', '우웩', '😭'],
        context: '슬픔을 나타냄',
        category: 'sad',
      },
    },
  },

  // 愤怒类
  angry: {
    primary: {
      'zh-CN': {
        primary: '😤',
        alternatives: ['气死我了', '哼', '😠', '凸 (￣ヘ￣)'],
        context: '表示生气和不满',
        category: 'angry',
      },
      'en-US': {
        primary: '😠',
        alternatives: ['Ugh!', 'Whatever!', '😡'],
        context: 'Show anger or frustration',
        category: 'angry',
      },
      'ja-JP': {
        primary: '(╯°□°）╯',
        alternatives: ['怒い', '嫌だ', '😤', 'ムカムカ'],
        context: 'テーブル返し怒り顔文字',
        category: 'angry',
      },
      'ko-KR': {
        primary: '😠',
        alternatives: ['짜증나', '노놉', '😤'],
        context: '화내거나 성가시게 여김',
        category: 'angry',
      },
    },
  },

  // 惊讶类
  surprised: {
    primary: {
      'zh-CN': {
        primary: '😮',
        alternatives: ['哇塞', '真的吗', '😱', 'Σ(oﾟдﾟo)'],
        context: '表示惊讶或震惊',
        category: 'surprised',
      },
      'en-US': {
        primary: '😲',
        alternatives: ['Wow!', 'OMG!', '😱'],
        context: 'Express surprise or shock',
        category: 'surprised',
      },
      'ja-JP': {
        primary: 'Σ(ﾉ≧∀≦) ﾉ',
        alternatives: ['えっ？', 'マジで', '😳', 'びっくり'],
        context: '驚きと戸惑い',
        category: 'surprised',
      },
      'ko-KR': {
        primary: '😮',
        alternatives: ['뭐? 진짜?', '😱', '놀라워'],
        context: '충격이나 놀람 표현',
        category: 'surprised',
      },
    },
  },

  // 思考类
  thinking: {
    primary: {
      'zh-CN': {
        primary: '🤔',
        alternatives: ['让我想想', '嗯...', '思考中', '(・_・;)'],
        context: '思考和犹豫时',
        category: 'neutral',
      },
      'en-US': {
        primary: '🤔',
        alternatives: ['Hmm...', 'Let me think', 'Thinking...'],
        context: 'Contemplating or considering',
        category: 'neutral',
      },
      'ja-JP': {
        primary: '(・∀・)',
        alternatives: ['ふむふむ', '考え中', '🤔', 'んー'],
        context: 'ゆっくり考える様',
        category: 'neutral',
      },
      'ko-KR': {
        primary: '🤔',
        alternatives: ['흠...', '생각 중', '으음...'],
        context: '곰곰이 생각할 때',
        category: 'neutral',
      },
    },
  },

  // 兴奋类
  excited: {
    primary: {
      'zh-CN': {
        primary: '🎉',
        alternatives: ['太棒啦', '耶!', '✨', '✌️'],
        context: '庆祝和兴奋的时刻',
        category: 'excited',
      },
      'en-US': {
        primary: '🎉',
        alternatives: ['Yay!', 'Woohoo!', 'Party time!'],
        context: 'Celebration and excitement',
        category: 'excited',
      },
      'ja-JP': {
        primary: '٩(◕‿◕｡)۶',
        alternatives: ['やった!', '嬉しい', '🎊', 'バグッ！'],
        context: '飛び跳ねる喜び',
        category: 'excited',
      },
      'ko-KR': {
        primary: '🎊',
        alternatives: ['야호!', '신났어', '짱이야!'],
        context: '축제와 흥분 상태',
        category: 'excited',
      },
    },
  },

  // 加油鼓励类
  encouragement: {
    primary: {
      'zh-CN': {
        primary: '💪',
        alternatives: ['加油', '你可以的', '✨', '🌟'],
        context: '鼓励和加油打气',
        category: 'excited',
      },
      'en-US': {
        primary: '💪',
        alternatives: ['You got this!', 'Go for it!', '👊'],
        context: 'Encouragement and support',
        category: 'excited',
      },
      'ja-JP': {
        primary: ' fighting! ✊',
        alternatives: ['頑張ってください', '応援してます', '👊', 'ガオー！'],
        context: '腕組みで励ます',
        category: 'excited',
      },
      'ko-KR': {
        primary: '💪',
        alternatives: ['화이팅!', '힘내!', '최고야!'],
        context: '격려와 응원 메시지',
        category: 'excited',
      },
    },
  },

  // 晚安睡眠类
  sleep: {
    primary: {
      'zh-CN': {
        primary: '💤',
        alternatives: ['晚安', 'zzZ', '🌙', '😴'],
        context: '睡觉和夜晚的问候',
        category: 'calm',
      },
      'en-US': {
        primary: '💤',
        alternatives: ['Good night', 'Sweet dreams', '🌙'],
        context: 'Sleep and nighttime greetings',
        category: 'calm',
      },
      'ja-JP': {
        primary: '💤',
        alternatives: ['おやすみ', 'おやすみなさい', '🌃', 'zzz'],
        context: 'おやすみと寝る準備',
        category: 'calm',
      },
      'ko-KR': {
        primary: '💤',
        alternatives: ['잘 자', '좋은 꿈', '🌛', '주무세요'],
        context: '취침 시간과 밤 인사',
        category: 'calm',
      },
    },
  },

  // 害羞类
  shy: {
    primary: {
      'zh-CN': {
        primary: '😊',
        alternatives: ['脸红', '不好意思', '😳', '(*/ω＼*)'],
        context: '害羞或尴尬时',
        category: 'neutral',
      },
      'en-US': {
        primary: '😊',
        alternatives: ['Aw shucks', 'Hehe', 'Blushing...'],
        context: 'Shy or embarrassed feelings',
        category: 'neutral',
      },
      'ja-JP': {
        primary: '(*^_^*)',
        alternatives: ['照れてる', '恥ずかしい', '(⁄ ⁄•⁄ω⁄•⁄ ⁄)', 'にこ'],
        context: '恥じらう顔',
        category: 'neutral',
      },
      'ko-KR': {
        primary: '😊',
        alternatives: ['부끄러워', '창피해', '에헤헤'],
        context: '수줍은 감정 표현',
        category: 'neutral',
      },
    },
  },
}

// ============ 实用工具函数 ============

/**
 * 获取当前文化的推荐表情
 */
export function getCulturalEmoji(key: string, locale: Locale): EmojiSet {
  const set = CULTURE_EMOJI_MAP[key]
  if (!set || !set.primary) {
    // Fallback to default culture
    return CULTURE_EMOJI_MAP.greeting?.primary['zh-CN'] || {
      primary: '😊',
      alternatives: [],
      context: '',
      category: 'neutral',
    }
  }
  
  return set.primary[locale] || set.primary['zh-CN']
}

/**
 * 随机选择一个备选表情
 */
export function getRandomEmoji(emojiSet: EmojiSet): string {
  const allEmojis = [emojiSet.primary, ...emojiSet.alternatives]
  return allEmojis[Math.floor(Math.random() * allEmojis.length)]
}

/**
 * 根据情感类别获取推荐表情
 */
export function getEmojiByCategory(category: EmojiSet['category'], locale: Locale): EmojiSet | null {
  for (const key in CULTURE_EMOJI_MAP) {
    const set = CULTURE_EMOJI_MAP[key].primary[locale]
    if (set && set.category === category) {
      return set
    }
  }
  return null
}
