import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'content.js'), 'utf8');
const start = source.indexOf('function extractTweetData(');
const end = source.indexOf('\n}\n\n// Draft.js', start) + 2;
const extractTweetData = Function(
  'buildArticleMarkdown',
  `return (${source.slice(start, end)})`,
)(() => '');

const scanStart = source.indexOf('function scanForTweets(');
const scanEnd = source.indexOf('\nfunction extractTweetData(', scanStart);
const scanForTweetsSource = source.slice(scanStart, scanEnd);

const findArticleStart = source.indexOf('function findArticleByTweetId(');
const findArticleEnd = source.indexOf('\nfunction updateLinkGeometry(', findArticleStart);
const findArticleByTweetIdSource = source.slice(findArticleStart, findArticleEnd);

const getTweetIdStart = source.indexOf('function getTweetIdFromArticle(');
const getTweetIdEnd = source.indexOf('\n// Periodic re-render', getTweetIdStart);
const getTweetIdFromArticleSource = source.slice(getTweetIdStart, getTweetIdEnd);

const renderBadgesStart = source.indexOf('function renderBadges(');
const renderBadgesEnd = source.indexOf('\nfunction renderBookmarkTimelineBadges(', renderBadgesStart);
const renderBadgesSource = source.slice(renderBadgesStart, renderBadgesEnd);

const getTweetTextStart = source.indexOf('function getTweetTextFromArticle(');
const getTweetTextEnd = source.indexOf('\nfunction getStatusIdFromLocation(', getTweetTextStart);
const getTweetTextFromArticleSource = source.slice(getTweetTextStart, getTweetTextEnd);

it('uses the outer post metrics when a repost contains retweeted_status_result', () => {
  // Given
  const original = {
    legacy: {
      id_str: '111',
      full_text: 'original post',
      created_at: 'Tue Jul 21 00:00:00 +0000 2026',
    },
    views: { state: 'EnabledWithCount', count: '9000' },
  };
  const repost = {
    legacy: {
      id_str: '2079393275182772690',
      full_text: 'repost',
      created_at: 'Tue Jul 21 01:00:00 +0000 2026',
      retweeted_status_result: { result: original },
    },
    views: { state: 'EnabledWithCount', count: '120' },
  };

  // When
  const data = extractTweetData(repost);

  // Then
  expect(data).toMatchObject({
    id: '2079393275182772690',
    views: 120,
    createdAt: 'Tue Jul 21 01:00:00 +0000 2026',
  });
});

it('uses cached X Article markdown instead of its permalink as AI prompt text', () => {
  const tweetDataStore = new Map([['2080877134319624492', {
    articleMd: '# A real article title\n\nThe article body contains the argument AI should discuss.',
  }]]);
  const article = {};
  const getTweetTextFromArticle = Function(
    'tweetDataStore',
    'getStatusIdFromLocation',
    'getTweetIdFromArticle',
    'getTweetPermalinkFromArticle',
    `${getTweetTextFromArticleSource}; return getTweetTextFromArticle;`,
  )(
    tweetDataStore,
    () => '2080877134319624492',
    () => '2080877134319624492',
    () => 'https://x.com/AI_Jasonyu/status/2080877134319624492',
  );

  expect(getTweetTextFromArticle(article)).toContain('The article body contains the argument AI should discuss.');
  expect(getTweetTextFromArticle(article)).not.toBe('https://x.com/AI_Jasonyu/status/2080877134319624492');
});

it('collects an embedded tweet from a TweetResultByRestId response', () => {
  // Given
  const { scanForTweets, tweetDataStore } = Function(
    'buildArticleMarkdown',
    `
      const tweetDataStore = new Map();
      function renderBadges() {}
      ${scanForTweetsSource}
      ${source.slice(start, end)}
      return { scanForTweets, tweetDataStore };
    `,
  )(() => '');
  const embedded = {
    legacy: {
      id_str: '2032858943874281782',
      full_text: 'embedded tweet',
      created_at: 'Sat Mar 14 16:38:35 +0000 2026',
    },
    views: { state: 'EnabledWithCount', count: '556065' },
  };
  const response = {
    data: {
      tweetResult: { result: embedded },
    },
  };

  // When
  scanForTweets(response);

  // Then
  expect(tweetDataStore.get('2032858943874281782')).toMatchObject({
    views: 556065,
    createdAt: 'Sat Mar 14 16:38:35 +0000 2026',
  });
});

it('mounts a badge in an embedded tweet header that has no caret button', () => {
  // Given
  let insertedBadge = null;
  const article = {
    hasAttribute: () => false,
    setAttribute() {},
    querySelector: (selector) => selector === '[data-testid="caret"]' ? null : null,
    querySelectorAll: (selector) => selector === '[data-testid="User-Name"]' ? [userName] : [],
  };
  const emptyHeaderSlot = {};
  const headerRow = {
    children: [{}, emptyHeaderSlot],
    lastElementChild: emptyHeaderSlot,
    parentElement: article,
    contains: (node) => node === userName,
    querySelector: (selector) => selector === '[data-testid="User-Name"]' ? userName : null,
    insertBefore: (badge) => { insertedBadge = badge; },
  };
  const userName = {
    parentElement: headerRow,
    closest: () => article,
  };
  const document = {
    querySelectorAll: () => [article],
    createElement: () => ({ dataset: {}, addEventListener() {} }),
  };
  const tweetDataStore = new Map([['2032858943874281782', {
    views: 556065,
    likes: 1,
    retweets: 2,
    replies: 3,
    bookmarks: 4,
    createdAt: 'Sat Mar 14 16:38:35 +0000 2026',
  }]]);
  const renderBadges = Function(
    'document',
    'tweetDataStore',
    'getComputedStyle',
    `
      const velocityThresholds = { trending: 1000, viral: 10000 };
      const leaderboardEnabled = false;
      const getTweetIdFromArticle = () => '2032858943874281782';
      const getTweetDataForArticle = (_article, id) => tweetDataStore.get(id);
      const computeScore = () => ({ velocity: 556, score: 10 });
      const formatVelocity = String;
      const i18n = (key) => key;
      const getTooltip = () => ({ contains: () => false, style: {} });
      const hideTooltip = () => {};
      const renderBookmarkTimelineBadges = () => {};
      const renderBookmarkCounts = () => {};
      const renderLeaderboard = () => {};
      ${renderBadgesSource}
      return renderBadges;
    `,
  )(document, tweetDataStore, (node) => ({
    display: node === headerRow ? 'flex' : 'block',
    flexDirection: node === headerRow ? 'row' : 'column',
  }));

  // When
  renderBadges();

  // Then
  expect(insertedBadge?.dataset).toMatchObject({ velocity: '556' });
});

it('reads scoreable metrics from an embedded tweet article element', () => {
  // Given
  const domDataStart = source.indexOf('function getTweetDataForArticle(');
  expect(domDataStart).toBeGreaterThan(-1);
  const domDataEnd = source.indexOf('\n// === Tooltip Container', domDataStart);
  const tweetDataStore = new Map();
  const outerArticle = {};
  const article = {
    parentElement: { closest: () => outerArticle },
    querySelectorAll(selector) {
      const bySelector = {
        'time[datetime]': [time],
        'a[href*="/status/2032858943874281782/analytics"]': [analytics],
        'button[data-testid="reply"]': [reply],
        'button[data-testid="retweet"]': [retweet],
        'button[data-testid="like"], button[data-testid="unlike"]': [like],
        '[role="group"]': [group],
        '[data-testid="tweetText"]': [tweetText],
        'a[href*="/status/2032858943874281782"]': [statusLink, analytics],
      };
      return bySelector[selector] || [];
    },
  };
  const own = (attributes = {}) => ({
    closest: () => article,
    getAttribute: (name) => attributes[name] ?? null,
    textContent: attributes.textContent || '',
  });
  const time = own({ datetime: '2026-03-14T16:38:35.000Z' });
  const analytics = own({ 'aria-label': '556074 次查看。查看帖子分析' });
  const reply = own({ 'aria-label': '215 回复。回复' });
  const retweet = own({ 'aria-label': '626 次转帖。转帖' });
  const like = own({ 'aria-label': '2,667 喜欢次数。喜欢' });
  const group = own({ 'aria-label': '215 回复、626 次转帖、2667 喜欢、4799 书签、556074 次观看' });
  const tweetText = own({ textContent: 'embedded tweet' });
  const statusLink = own({ href: '/yan5xu/status/2032858943874281782' });
  const getTweetDataForArticle = Function(
    'tweetDataStore',
    `${source.slice(domDataStart, domDataEnd)}; return getTweetDataForArticle;`,
  )(tweetDataStore);

  // When
  const data = getTweetDataForArticle(article, '2032858943874281782');

  // Then
  expect(data).toMatchObject({
    id: '2032858943874281782',
    screenName: 'yan5xu',
    views: 556074,
    likes: 2667,
    retweets: 626,
    replies: 215,
    bookmarks: 4799,
    createdAt: '2026-03-14T16:38:35.000Z',
    text: 'embedded tweet',
  });
  expect(tweetDataStore.get('2032858943874281782')).toBe(data);
});

it('finds the nested tweet article instead of its outer article container', () => {
  // Given
  const tweetDataStore = new Map([['2032858943874281782', {}]]);
  const outerArticle = {};
  const nestedArticle = {};
  const outerLink = {
    getAttribute: () => '/icycat/status/2033096808076030044',
    closest: () => outerArticle,
  };
  const nestedLink = {
    getAttribute: () => '/yan5xu/status/2032858943874281782',
    closest: () => nestedArticle,
  };
  outerArticle.querySelectorAll = () => [outerLink, nestedLink];
  outerArticle.querySelector = () => outerLink;
  nestedArticle.querySelectorAll = () => [nestedLink];
  nestedArticle.querySelector = () => nestedLink;
  const document = {
    querySelectorAll: () => [outerArticle, nestedArticle],
  };
  const findArticleByTweetId = Function(
    'tweetDataStore',
    'document',
    'isLeaderboardArticleHidden',
    `
      ${findArticleByTweetIdSource}
      ${getTweetIdFromArticleSource}
      return findArticleByTweetId;
    `,
  )(tweetDataStore, document, () => false);

  // When
  const article = findArticleByTweetId('2032858943874281782');

  // Then
  expect(article).toBe(nestedArticle);
});
