// Built-in content filter rules.
//
// Keep this object in sync with rules.json. The MAIN-world content script
// cannot safely read extension JSON via chrome.runtime, so this wrapper exposes
// the same data as an executable content/popup script.

(function () {
  const rules = {
    version: 1,
    levels: {
      light: [
        'hard-telegram-group-funnel',
      ],
      standard: [
        'hard-telegram-group-funnel',
        'adult-sex-service-high',
        'adult-nude-leak-high',
        'adult-name-offline-high',
        'adult-location-offline-high',
        'spam-gambling-high',
        'spam-phishing-airdrop-high',
        'spam-name-click-profile-high',
        'spam-name-funnel-high',
        'spam-short-symbol-content-high',
        'spam-bio-zhongtui-high',
        'spam-content-zhongtui-high',
      ],
      strict: [
        'hard-telegram-group-funnel',
        'adult-sex-service-high',
        'adult-nude-leak-high',
        'adult-name-offline-high',
        'adult-location-offline-high',
        'spam-gambling-high',
        'spam-phishing-airdrop-high',
        'spam-name-click-profile-high',
        'spam-name-funnel-high',
        'spam-short-symbol-content-high',
        'spam-bio-zhongtui-high',
        'spam-content-zhongtui-high',
        'adult-bio-medium',
        'spam-telegram-domain-medium',
        'spam-private-chat-medium',
        'spam-marketing-medium',
      ],
    },
    rules: [
      {
        id: 'hard-telegram-group-funnel',
        type: 'regex',
        field: 'content',
        value: '(t\\.me|telegram|电报|飞机).{0,24}(中推|中文推特|群|频道|福利|资源|私信|加|宝宝|点这里|靠谱|选人|教程|同城|线下|上门|约P|约炮|曰泡)',
        severity: 'block',
      },
      {
        id: 'adult-sex-service-high',
        type: 'regex',
        field: 'content',
        value: '(约炮|裸聊|外围|包养|上门服务|援交|同城可约)',
        severity: 'high',
      },
      {
        id: 'adult-nude-leak-high',
        type: 'regex',
        field: 'content',
        value: '(私房照|裸照|流出|国产自拍|成人视频|成人资源)',
        severity: 'high',
      },
      {
        id: 'adult-bio-medium',
        type: 'regex',
        field: 'bio',
        value: '(性生理|两性|私密|成人|福利姬)',
        severity: 'medium',
      },
      {
        id: 'adult-name-offline-high',
        type: 'regex',
        field: 'name',
        value: '(同城上门|同城约|约见|约P|固炮|曰泡|上门|资源入口|线下约见|真实约见|看我(简介|主页|置顶)|点我(头像|主页)|点击主页)',
        severity: 'high',
      },
      {
        id: 'adult-location-offline-high',
        type: 'regex',
        field: 'location',
        value: '(联系.{0,6}(直接)?点击大号|点击大号|看大号|约线下|(同城|附近).{0,6}(可约|线下|见面))',
        severity: 'high',
      },
      {
        id: 'adult-soft-low',
        type: 'regex',
        field: 'content',
        value: '(福利视频|擦边|大尺度|黑丝|写真)',
        severity: 'low',
      },
      {
        id: 'spam-gambling-high',
        type: 'regex',
        field: 'content',
        value: '(博彩|赌场|娱乐城|投注平台|澳门线上娱乐|百家乐|体育投注)',
        severity: 'high',
      },
      {
        id: 'spam-phishing-airdrop-high',
        type: 'regex',
        field: 'content',
        value: '(空投|领取奖励|钱包授权|助记词|私钥|钓鱼链接|claim now)',
        severity: 'high',
      },
      {
        id: 'spam-name-click-profile-high',
        type: 'regex',
        field: 'name',
        value: '(点击主页|点主页|看主页|主页看|主页有)',
        severity: 'high',
      },
      {
        id: 'spam-name-funnel-high',
        type: 'regex',
        field: 'name',
        value: '(点(我)?(头像|主页)|点击(头像|主页)|看(我)?(头像|主页)|互联网赚|网赚|返佣|费破|免费.{0,4}(破|约)|约见|约P|固炮|同城上门)',
        severity: 'high',
      },
      {
        id: 'spam-short-symbol-content-high',
        type: 'short-symbol',
        field: 'content',
        value: 'short-symbol-or-emoji',
        severity: 'high',
      },
      {
        id: 'spam-bio-zhongtui-high',
        type: 'regex',
        field: 'bio',
        value: '(中推|中文推特|电报|telegram|频道|福利|私信|加群|接推广|福利.{0,4}资源|电报.{0,12}资源|t\\.me.{0,20}资源)',
        severity: 'high',
      },
      {
        id: 'spam-content-zhongtui-high',
        type: 'regex',
        field: 'content',
        value: '(中推|中文推特|电报|telegram|频道|福利|资源|私信|加群|接推广)',
        severity: 'high',
      },
      {
        id: 'spam-telegram-domain-medium',
        type: 'domain',
        field: 'url',
        value: 't.me',
        severity: 'medium',
      },
      {
        id: 'spam-private-chat-medium',
        type: 'regex',
        field: 'content',
        value: '(私信|私讯|加我|进群|群聊).{0,16}(福利|资源|项目|带你|名额)',
        severity: 'medium',
      },
      {
        id: 'spam-marketing-medium',
        type: 'regex',
        field: 'content',
        value: '(进社群|合作.*微信|推广案例|网盘拉新|空投|合约|暴富)',
        severity: 'medium',
      },
      {
        id: 'spam-crypto-low',
        type: 'regex',
        field: 'content',
        value: '(合约带单|百倍币|稳赚|暴富密码|充值返利)',
        severity: 'low',
      },
    ],
  };

  window.__xvmContentFilterBuiltinRules = rules;
})();
