const brandFile = (filename) => `/brand/${filename}`

/**
 * Shared catalog for FlowLab's public brand artwork.
 *
 * Keep page code pointed at these semantic names instead of individual files.
 * That lets the team refine or replace an asset without hunting through every
 * page for hard-coded public paths.
 */
export const BRAND_ASSETS = Object.freeze({
  appIcon: brandFile('flowlab-shell-app-icon-192.png'),
  shellBaseIcon: brandFile('flowlab-shell-base-icon-v1.png'),
  wordmark: brandFile('flowlab-wordmark-icon-o-v1.png'),
  logoMascot: brandFile('flowlab-logo-imagegen-felt-v1.png'),
  communityAvatar: brandFile('flowlab-community-egg-avatar.png'),
  characterRoleBoard: brandFile('flowlab-felt-character-board-v5-role-system.png'),
  interviewCoachWriting: brandFile('flowlab-interview-coach-writing.png'),
  reviewMentorWriting: brandFile('flowlab-review-mentor-writing.png'),
  resumeTailorWorking: brandFile('flowlab-resume-tailor-working.png'),
  brandIdentityStickerBoard: brandFile('flowlab-brand-identity-sticker-board.png'),
  stickers: Object.freeze({
    youGotThis: brandFile('flowlab-sticker-you-got-this.png'),
    workingOnLaptop: brandFile('flowlab-sticker-working-on-laptop.png'),
    practiceTodayFlowTomorrow: brandFile('flowlab-sticker-practice-today-flow-tomorrow.png'),
    nice: brandFile('flowlab-sticker-nice.png'),
    interviewPractice: brandFile('flowlab-sticker-interview-practice.png'),
    smallStepsBigTomorrow: brandFile('flowlab-sticker-small-steps-big-tomorrow.png'),
    shellWave: brandFile('flowlab-sticker-shell-wave.png'),
    goodProgress: brandFile('flowlab-sticker-good-progress.png'),
  }),
})
