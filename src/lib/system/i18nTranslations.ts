/**
 * @file i18nTranslations.ts
 * @deprecated 自 2026-08-27（批次二 A-9）起废弃。翻译资源已由 `lib/i18n.ts` 的 react-i18next 资源
 * （zh/en/ja/ko/zh-TW 内联对象 + `public/locales` JSON）统一承载。本文件仅为 `i18nManager.ts` 的历史依赖，
 * 二者均无运行链路消费方，禁止在新代码中 import。
 * @description 多语言翻译数据集（历史实现，已废弃）— 中文/英文/日文/韩文
 */

export type Locale = 'zh-CN' | 'en-US' | 'ja-JP' | 'ko-KR'

export interface TranslationBundle {
  common: {
    ok: string
    cancel: string
    save: string
    delete: string
    edit: string
    add: string
    search: string
    settings: string
    help: string
    loading: string
    error: string
    success: string
    warning: string
    info: string
    yes: string
    no: string
    close: string
    back: string
    next: string
    done: string
  }
  pet: {
    name: string
    feed: string
    play: string
    sleep: string
    wakeUp: string
    hide: string
    show: string
    settings: string
    level: string
    happiness: string
    hunger: string
    energy: string
    health: string
  }
  interaction: {
    greeting: string
    goodMorning: string
    goodAfternoon: string
    goodEvening: string
    goodNight: string
    thanks: string
    sorry: string
    love: string
    joke: string
    compliment: string
  }
  menu: {
    home: string
    profile: string
    memories: string
    journal: string
    calendar: string
    miniMode: string
    fullScreen: string
    exit: string
    about: string
  }
  emotions: {
    happy: string
    sad: string
    angry: string
    excited: string
    calm: string
    confused: string
    tired: string
    surprised: string
    proud: string
    frustrated: string
    neutral: string
  }
  time: {
    today: string
    yesterday: string
    tomorrow: string
    thisWeek: string
    thisMonth: string
    ago: string
    fromNow: string
    now: string
    minutesAgo: string
    hoursAgo: string
    daysAgo: string
    monday: string
    tuesday: string
    wednesday: string
    thursday: string
    friday: string
    saturday: string
    sunday: string
  }
  reminders: {
    eventStarting: string
    eventReminder: string
    meetingSoon: string
    deadlineApproaching: string
    customReminder: string
  }
}

// ============ 中文（简体中文）============

export const translations_zh_CN: TranslationBundle = {
  common: {
    ok: '确定',
    cancel: '取消',
    save: '保存',
    delete: '删除',
    edit: '编辑',
    add: '添加',
    search: '搜索',
    settings: '设置',
    help: '帮助',
    loading: '加载中...',
    error: '错误',
    success: '成功',
    warning: '警告',
    info: '信息',
    yes: '是',
    no: '否',
    close: '关闭',
    back: '返回',
    next: '下一步',
    done: '完成',
  },
  pet: {
    name: '宠物名称',
    feed: '喂食',
    play: '玩耍',
    sleep: '睡觉',
    wakeUp: '唤醒',
    hide: '躲藏',
    show: '显示',
    settings: '宠物设置',
    level: '等级',
    happiness: '快乐值',
    hunger: '饥饿度',
    energy: '能量',
    health: '健康',
  },
  interaction: {
    greeting: '你好！我是 SpiritPal，你的 AI 桌面伙伴～',
    goodMorning: '早上好！新的一天开始了，加油呀！☀️',
    goodAfternoon: '下午好！休息一下再继续吧～',
    goodEvening: '晚上好！今天过得怎么样？🌙',
    goodNight: '晚安！做个好梦～💤',
    thanks: '不客气！能帮到你我很开心！',
    sorry: '没关系！我理解啦～',
    love: '我也最喜欢你了！❤️',
    joke: '为什么要给电脑装空调？因为它会 Windows！😄',
    compliment: '你今天看起来超级棒！继续保持哦！✨',
  },
  menu: {
    home: '主页',
    profile: '个人档案',
    memories: '记忆',
    journal: '日记',
    calendar: '日历',
    miniMode: '迷你模式',
    fullScreen: '全屏模式',
    exit: '退出',
    about: '关于',
  },
  emotions: {
    happy: '开心',
    sad: '难过',
    angry: '生气',
    excited: '兴奋',
    calm: '平静',
    confused: '困惑',
    tired: '疲惫',
    surprised: '惊讶',
    proud: '自豪',
    frustrated: '沮丧',
    neutral: '中性',
  },
  time: {
    today: '今天',
    yesterday: '昨天',
    tomorrow: '明天',
    thisWeek: '本周',
    thisMonth: '本月',
    ago: '前',
    fromNow: '后',
    now: '现在',
    minutesAgo: '{n}分钟前',
    hoursAgo: '{n}小时前',
    daysAgo: '{n}天前',
    monday: '星期一',
    tuesday: '星期二',
    wednesday: '星期三',
    thursday: '星期四',
    friday: '星期五',
    saturday: '星期六',
    sunday: '星期日',
  },
  reminders: {
    eventStarting: '提醒："{event}"即将开始',
    eventReminder: '别忘了参加"{event}"哦',
    meetingSoon: '距离会议开始还有{n}分钟',
    deadlineApproaching: '{task}的截止日期快到了',
    customReminder: '{reminder}: {time}',
  },
}

// ============ 英文（美式英语）============

export const translations_en_US: TranslationBundle = {
  common: {
    ok: 'OK',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    search: 'Search',
    settings: 'Settings',
    help: 'Help',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    warning: 'Warning',
    info: 'Info',
    yes: 'Yes',
    no: 'No',
    close: 'Close',
    back: 'Back',
    next: 'Next',
    done: 'Done',
  },
  pet: {
    name: 'Pet Name',
    feed: 'Feed',
    play: 'Play',
    sleep: 'Sleep',
    wakeUp: 'Wake Up',
    hide: 'Hide',
    show: 'Show',
    settings: 'Pet Settings',
    level: 'Level',
    happiness: 'Happiness',
    hunger: 'Hunger',
    energy: 'Energy',
    health: 'Health',
  },
  interaction: {
    greeting: 'Hi! I\'m SpiritPal, your AI desktop companion~',
    goodMorning: 'Good morning! New day, let\'s do this! ☀️',
    goodAfternoon: 'Good afternoon! Time for a quick break~',
    goodEvening: 'Good evening! How was your day? 🌙',
    goodNight: 'Good night! Sweet dreams~ 💤',
    thanks: 'You\'re welcome! Glad I could help!',
    sorry: 'No worries! I understand~',
    love: 'I love you too! ❤️',
    joke: 'Why did the computer get cold? It left its Windows open! 😄',
    compliment: 'You look awesome today! Keep it up! ✨',
  },
  menu: {
    home: 'Home',
    profile: 'Profile',
    memories: 'Memories',
    journal: 'Journal',
    calendar: 'Calendar',
    miniMode: 'Mini Mode',
    fullScreen: 'Full Screen',
    exit: 'Exit',
    about: 'About',
  },
  emotions: {
    happy: 'Happy',
    sad: 'Sad',
    angry: 'Angry',
    excited: 'Excited',
    calm: 'Calm',
    confused: 'Confused',
    tired: 'Tired',
    surprised: 'Surprised',
    proud: 'Proud',
    frustrated: 'Frustrated',
    neutral: 'Neutral',
  },
  time: {
    today: 'Today',
    yesterday: 'Yesterday',
    tomorrow: 'Tomorrow',
    thisWeek: 'This Week',
    thisMonth: 'This Month',
    ago: 'ago',
    fromNow: 'from now',
    now: 'Now',
    minutesAgo: '{n} min ago',
    hoursAgo: '{n} hr ago',
    daysAgo: '{n} day(s) ago',
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
    sunday: 'Sunday',
  },
  reminders: {
    eventStarting: 'Reminder: "{event}" is starting soon',
    eventReminder: 'Don\'t forget about "{event}"',
    meetingSoon: 'Meeting in {n} minutes',
    deadlineApproaching: '{task} deadline is approaching',
    customReminder: '{reminder}: {time}',
  },
}

// ============ 日文 ============

export const translations_ja_JP: TranslationBundle = {
  common: {
    ok: 'OK',
    cancel: 'キャンセル',
    save: '保存',
    delete: '削除',
    edit: '編集',
    add: '追加',
    search: '検索',
    settings: '設定',
    help: 'ヘルプ',
    loading: '読み込み中...',
    error: 'エラー',
    success: '成功',
    warning: '警告',
    info: '情報',
    yes: 'はい',
    no: 'いいえ',
    close: '閉じる',
    back: '戻る',
    next: '次へ',
    done: '完了',
  },
  pet: {
    name: 'ペットの名前',
    feed: 'エサやり',
    play: '遊ぶ',
    sleep: '寝る',
    wakeUp: '起こす',
    hide: 'かくれる',
    show: '表示',
    settings: 'ペット設定',
    level: 'レベル',
    happiness: '幸せ',
    hunger: '空腹',
    energy: 'エネルギー',
    health: '健康',
  },
  interaction: {
    greeting: 'こんにちは！SpiritPal です！あなたの AI デスクトップパートナーよ〜',
    goodMorning: 'おはようございます！新しい一日ですね！☀️',
    goodAfternoon: 'こんにちは！少し休憩しませんか？〜',
    goodEvening: 'こんばんは！今日はどうでしたか？🌙',
    goodNight: 'おやすみなさい！素敵な夢を〜 💤',
    thanks: 'どういたしまして！お手伝いできて嬉しいです！',
    sorry: '大丈夫ですよ！分かります〜',
    love: '私も大好きです！❤️',
    joke: 'なんでパソコンは寒いんですか？Windows を開いたままですから！😄',
    compliment: '今日はとても素敵ですよ！そのまま続けてください！✨',
  },
  menu: {
    home: 'ホーム',
    profile: 'プロフィール',
    memories: '記憶',
    journal: '日記',
    calendar: 'カレンダー',
    miniMode: 'ミニモード',
    fullScreen: '全画面',
    exit: '終了',
    about: 'について',
  },
  emotions: {
    happy: '嬉しい',
    sad: '悲しい',
    angry: '怒り',
    excited: '興奮',
    calm: '冷静',
    confused: '混乱',
    tired: '疲れた',
    surprised: '驚き',
    proud: '誇り',
    frustrated: '落ち込んだ',
    neutral: '普通',
  },
  time: {
    today: '今日',
    yesterday: '昨日',
    tomorrow: '明日',
    thisWeek: '今週',
    thisMonth: '今月',
    ago: '前',
    fromNow: '後',
    now: '現在',
    minutesAgo: '{n}分前',
    hoursAgo: '{n}時間前',
    daysAgo: '{n}日前',
    monday: '月曜日',
    tuesday: '火曜日',
    wednesday: '水曜日',
    thursday: '木曜日',
    friday: '金曜日',
    saturday: '土曜日',
    sunday: '日曜日',
  },
  reminders: {
    eventStarting: 'リマインダー：「{event}」がまもなく始まります',
    eventReminder: '「{event}」をお忘れなく',
    meetingSoon: '{n}分で会議が始まります',
    deadlineApproaching: '{task}の締め切りが近づいています',
    customReminder: '{reminder}: {time}',
  },
}

// ============ 韩文 ============

export const translations_ko_KR: TranslationBundle = {
  common: {
    ok: '확인',
    cancel: '취소',
    save: '저장',
    delete: '삭제',
    edit: '수정',
    add: '추가',
    search: '검색',
    settings: '설정',
    help: '도움말',
    loading: '로딩 중...',
    error: '오류',
    success: '성공',
    warning: '경고',
    info: '정보',
    yes: '예',
    no: '아니요',
    close: '닫기',
    back: '뒤로',
    next: '다음',
    done: '완료',
  },
  pet: {
    name: '펫 이름',
    feed: '먹이주기',
    play: '놀이',
    sleep: '자기',
    wakeUp: '깨우기',
    hide: '숨기기',
    show: '보이기',
    settings: '펫 설정',
    level: '레벨',
    happiness: '행복도',
    hunger: '배고픔',
    energy: '에너지',
    health: '건강',
  },
  interaction: {
    greeting: '안녕하세요! 저는 SpiritPal 입니다. 당신의 AI 데스크톱 파트너예요~',
    goodMorning: '좋은 아침이에요! 새 하루 시작이네요! ☀️',
    goodAfternoon: '좋은 오후에요! 잠시 휴식 시간 어때요?~',
    goodEvening: '좋은 저녁이에요! 오늘 어떻게 지내셨나요? 🌙',
    goodNight: '굿나잇! 좋은 꿈 꾸세요~ 💤',
    thanks: '천만에요! 도와드릴게 기뻐요!',
    sorry: '괜찮아요! 이해해요~',
    love: '나도 당신 좋아해요! ❤️',
    joke: '왜 컴퓨터가 추웠을까요? 창문을 열어놓았거든요! 😄',
    compliment: '오늘 정말 멋져 보여요! 계속 그렇게 가세요! ✨',
  },
  menu: {
    home: '홈',
    profile: '프로필',
    memories: '기억',
    journal: '일기',
    calendar: '캘린더',
    miniMode: '미니 모드',
    fullScreen: '전체화면',
    exit: '종료',
    about: '소개',
  },
  emotions: {
    happy: '행복함',
    sad: '슬픔',
    angry: '화남',
    excited: 'excited',
    calm: '침착함',
    confused: '혼란',
    tired: '피로',
    surprised: '놀람',
    proud: '자랑',
    frustrated: '실망',
    neutral: '중립',
  },
  time: {
    today: '오늘',
    yesterday: '어제',
    tomorrow: '내일',
    thisWeek: '이번 주',
    thisMonth: '이번 달',
    ago: '전',
    fromNow: '후',
    now: '지금',
    minutesAgo: '{n}분 전',
    hoursAgo: '{n}시간 전',
    daysAgo: '{n}일 전',
    monday: '월요일',
    tuesday: '화요일',
    wednesday: '수요일',
    thursday: '목요일',
    friday: '금요일',
    saturday: '토요일',
    sunday: '일요일',
  },
  reminders: {
    eventStarting: '알림: "{event}"가 곧 시작됩니다',
    eventReminder: '"{event}" 잊지 마세요',
    meetingSoon: '{n}분 후 회의 시작',
    deadlineApproaching: '{task} 마감일이 다가옵니다',
    customReminder: '{reminder}: {time}',
  },
}
