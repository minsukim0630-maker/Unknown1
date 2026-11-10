/*
 * 게임 데이터 정의 (밸런스 수치는 전부 여기서 조정)
 * 브라우저에서는 전역 GameData, Node 에서는 module.exports 로 노출된다.
 */
(function (root) {
  'use strict';

  const STAT_KEYS = ['speed', 'power', 'technique', 'stamina', 'jump'];

  const STAT_NAMES = {
    speed: '스피드',
    power: '파워',
    technique: '테크닉',
    stamina: '스태미나',
    jump: '점프',
  };

  const STAT_CAP = 1200;
  const MAX_ENERGY = 100;

  // 3년 × 12개월 × (전반/후반) = 72턴
  const YEARS = 3;
  const TURNS_PER_YEAR = 24;
  const TOTAL_TURNS = YEARS * TURNS_PER_YEAR;

  // 합숙: 2·3년차 7월~8월 (트레이닝 레벨이 전부 5로 고정)
  const CAMP_MONTHS = [7, 8];
  const CAMP_YEARS = [2, 3];

  // 트레이닝 시설 레벨 업에 필요한 사용 횟수
  const USES_PER_LEVEL = 4;
  const MAX_TRAINING_LEVEL = 5;

  /*
   * 트레이닝 정의
   * gains[스탯] = [Lv1, Lv2, Lv3, Lv4, Lv5] 기본 상승치
   * energy: 기본 체력 소모 (레벨이 오를수록 1씩 더 소모)
   * failThreshold: 이 체력 미만부터 실패 확률 발생
   */
  const TRAININGS = {
    speed: {
      name: '스피드',
      icon: '💨',
      desc: '전력 질주로 순발력을 단련한다.',
      gains: {
        speed: [18, 20, 22, 24, 27],
        power: [8, 9, 10, 11, 12],
      },
      energy: 21,
      failThreshold: 50,
    },
    power: {
      name: '파워',
      icon: '💪',
      desc: '무거운 바위를 밀며 근력을 기른다.',
      gains: {
        power: [17, 19, 21, 23, 26],
        stamina: [8, 9, 10, 11, 12],
      },
      energy: 20,
      failThreshold: 50,
    },
    technique: {
      name: '테크닉',
      icon: '🎯',
      desc: '공 다루기·방향 전환으로 기술을 연마한다.',
      gains: {
        technique: [15, 17, 19, 21, 23],
        speed: [6, 7, 8, 9, 10],
      },
      energy: 6,
      failThreshold: 30,
    },
    stamina: {
      name: '스태미나',
      icon: '🫀',
      desc: '장거리 수영으로 지구력을 키운다.',
      gains: {
        stamina: [17, 19, 21, 23, 26],
        jump: [8, 9, 10, 11, 12],
      },
      energy: 19,
      failThreshold: 50,
    },
    jump: {
      name: '점프',
      icon: '🦘',
      desc: '허들과 트램펄린으로 도약력을 높인다.',
      gains: {
        jump: [17, 19, 21, 23, 26],
        power: [5, 6, 7, 8, 9],
        technique: [5, 6, 6, 7, 8],
      },
      energy: 22,
      failThreshold: 50,
    },
  };

  // 컨디션: -2 ~ +2, 트레이닝 효율 배율 = 1 + 0.1 × mood
  const MOODS = {
    '-2': { name: '절불조', icon: '😫', cls: 'mood-awful' },
    '-1': { name: '불조', icon: '😞', cls: 'mood-bad' },
    '0': { name: '보통', icon: '😐', cls: 'mood-normal' },
    '1': { name: '호조', icon: '😊', cls: 'mood-good' },
    '2': { name: '절호조', icon: '🤩', cls: 'mood-great' },
  };

  // 육성 대상 가상 포켓몬 (오리지널)
  const SPECIES = [
    {
      id: 'voltfox',
      name: '볼트폭스',
      icon: '🦊',
      desc: '번개처럼 빠른 여우 포켓몬. 스피드·점프 성장률이 높다.',
      baseStats: { speed: 110, power: 70, technique: 80, stamina: 70, jump: 100 },
      growth: { speed: 0.1, jump: 0.1 },
    },
    {
      id: 'rockturtle',
      name: '록터틀',
      icon: '🐢',
      desc: '단단한 등껍질의 거북 포켓몬. 파워·스태미나 성장률이 높다.',
      baseStats: { speed: 60, power: 120, technique: 70, stamina: 110, jump: 60 },
      growth: { power: 0.1, stamina: 0.1 },
    },
    {
      id: 'cloudbunny',
      name: '클라우버니',
      icon: '🐇',
      desc: '구름 위를 뛰노는 토끼 포켓몬. 테크닉·점프 성장률이 높다.',
      baseStats: { speed: 85, power: 65, technique: 110, stamina: 70, jump: 100 },
      growth: { technique: 0.1, jump: 0.1 },
    },
  ];

  /*
   * 서포터 (함께 트레이닝해 주는 동료)
   * type: 득의 트레이닝. 'friend' 는 득의 없음(어디든 나타나며 체력 소모를 줄여준다)
   * trainBonus: 함께할 때 트레이닝 효과 +%
   * friendBonus: 유대 80 이상 + 득의 트레이닝일 때 '우정 트레이닝' 배율 +%
   */
  const SUPPORTERS = [
    { id: 'haru', name: '하루', icon: '🏃', role: '육상부 코치', type: 'speed', trainBonus: 0.1, friendBonus: 0.25 },
    { id: 'dandan', name: '단단', icon: '🏋️', role: '역도 선수', type: 'power', trainBonus: 0.1, friendBonus: 0.25 },
    { id: 'sol', name: '솔', icon: '🧩', role: '전략 분석가', type: 'technique', trainBonus: 0.1, friendBonus: 0.25 },
    { id: 'nuri', name: '누리', icon: '🏊', role: '수영 강사', type: 'stamina', trainBonus: 0.1, friendBonus: 0.25 },
    { id: 'dodo', name: '도도', icon: '🤸', role: '체조 선수', type: 'jump', trainBonus: 0.1, friendBonus: 0.25 },
    { id: 'momo', name: '모모', icon: '🧃', role: '단짝 친구', type: 'friend', trainBonus: 0.05, friendBonus: 0, energySave: 5 },
  ];

  const FRIENDSHIP_MAX = 100;
  const FRIENDSHIP_TRAINING_THRESHOLD = 80;
  const FRIENDSHIP_GAIN_PER_TRAINING = 7;

  // 서포터 배치 확률
  const SUPPORTER_ABSENT_RATE = 0.15;
  const SUPPORTER_SPECIALTY_RATE = 0.45;

  // 휴식 회복량 [회복량, 확률]
  const REST_TABLE = [
    [70, 0.5],
    [50, 0.35],
    [30, 0.15],
  ];

  // 이벤트 발생 확률 (행동 후)
  const EVENT_RATE = 0.15;

  /*
   * 랜덤 이벤트
   * effect: { energy, mood, stats: {..}, friendship: { id|'random': n } }
   * choices 가 있으면 플레이어가 선택
   */
  const EVENTS = [
    {
      id: 'snack',
      title: '간식 시간',
      text: '{name}이(가) 트레이너 가방에서 나무열매를 발견했다!',
      weight: 10,
      choices: [
        { label: '같이 먹는다', effect: { energy: 15 } },
        { label: '나중을 위해 남겨둔다', effect: { mood: 1 } },
      ],
    },
    {
      id: 'good_dream',
      title: '좋은 꿈',
      text: '{name}이(가) 포케슬론 우승하는 꿈을 꾼 모양이다.',
      weight: 8,
      effect: { mood: 1 },
    },
    {
      id: 'rain',
      title: '갑작스러운 소나기',
      text: '훈련 도중 비에 흠뻑 젖고 말았다…',
      weight: 6,
      effect: { mood: -1, energy: -5 },
    },
    {
      id: 'self_training',
      title: '자율 훈련',
      text: '{name}이(가) 혼자 남아 연습을 하고 있다. 어떻게 할까?',
      weight: 8,
      choices: [
        { label: '함께 조금 더 한다', effect: { stats: { random: 15 }, energy: -10 } },
        { label: '오늘은 쉬라고 한다', effect: { energy: 10 } },
      ],
    },
    {
      id: 'rival',
      title: '라이벌 등장',
      text: '다른 트레이너의 포켓몬이 시비를 걸어왔다!',
      weight: 6,
      choices: [
        { label: '달리기 시합으로 응수', effect: { stats: { speed: 10, stamina: 5 }, energy: -10 } },
        { label: '점프 대결로 응수', effect: { stats: { jump: 10, power: 5 }, energy: -10 } },
      ],
    },
    {
      id: 'supporter_visit',
      title: '동료의 응원',
      text: '서포터 {supporter}이(가) 응원하러 찾아왔다.',
      weight: 8,
      effect: { friendship: { random: 10 }, mood: 1 },
    },
    {
      id: 'stretch',
      title: '스트레칭 연구',
      text: '새로운 스트레칭 방법을 익혔다. 몸이 가벼워진 느낌!',
      weight: 6,
      effect: { stats: { technique: 8 }, energy: 5 },
    },
    {
      id: 'tired',
      title: '피로 누적',
      text: '{name}이(가) 조금 지쳐 보인다…',
      weight: 5,
      effect: { energy: -10 },
    },
  ];

  // 스탯 랭크 (상한 1200 기준)
  const RANKS = [
    [1150, 'SS'],
    [1050, 'S+'],
    [950, 'S'],
    [850, 'A+'],
    [750, 'A'],
    [650, 'B+'],
    [550, 'B'],
    [450, 'C+'],
    [350, 'C'],
    [300, 'D+'],
    [250, 'D'],
    [200, 'E+'],
    [150, 'E'],
    [100, 'F+'],
    [50, 'F'],
    [0, 'G'],
  ];

  const GameData = {
    STAT_KEYS,
    STAT_NAMES,
    STAT_CAP,
    MAX_ENERGY,
    YEARS,
    TURNS_PER_YEAR,
    TOTAL_TURNS,
    CAMP_MONTHS,
    CAMP_YEARS,
    USES_PER_LEVEL,
    MAX_TRAINING_LEVEL,
    TRAININGS,
    MOODS,
    SPECIES,
    SUPPORTERS,
    FRIENDSHIP_MAX,
    FRIENDSHIP_TRAINING_THRESHOLD,
    FRIENDSHIP_GAIN_PER_TRAINING,
    SUPPORTER_ABSENT_RATE,
    SUPPORTER_SPECIALTY_RATE,
    REST_TABLE,
    EVENT_RATE,
    EVENTS,
    RANKS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameData;
  } else {
    root.GameData = GameData;
  }
})(typeof window !== 'undefined' ? window : globalThis);
