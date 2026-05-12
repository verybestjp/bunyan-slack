const util = require('util');

/** webhook URL 文字列ごとの最終 POST 時刻（ミリ秒）。プロセス内でのみ有効。 */
const GLOBAL_RATE_LIMIT_MAP_KEY = '__bunyan_slack_webhook_last_post_ms_map__';
const webhookLastPostMsMap = globalThis[GLOBAL_RATE_LIMIT_MAP_KEY] || new Map();
globalThis[GLOBAL_RATE_LIMIT_MAP_KEY] = webhookLastPostMsMap;

/**
 * 同一 URL への POST を minIntervalMs 間隔で制限する。
 * @param {string} url
 * @param {number} minIntervalMs 0 以下のときは制限しない
 * @returns {boolean} 送信してよいとき true（通過した時点で最終送信時刻を更新する）
 */
function tryAcquireWebhookPost(url, minIntervalMs) {
  if (minIntervalMs <= 0) {
    return true;
  }
  const now = Date.now();
  const last = webhookLastPostMsMap.get(url) || 0;
  if (now - last < minIntervalMs) {
    return false;
  }
  webhookLastPostMsMap.set(url, now);
  return true;
}

function BunyanSlack(options, error) {
  options = options || {};
  if (!options.webhook_url && !options.webhookUrl) {
    throw new Error('webhook url cannot be null');
  } else {

    this.customFormatter = options.customFormatter;
    this.webhook_url     = options.webhook_url || options.webhookUrl;
    this.error           = error               || function() {};
    // 既定 1000ms（1 秒に 1 件）。0 で無制限。
    this.webhook_rate_limit_ms = typeof options.webhook_rate_limit_ms === 'number' ?
      options.webhook_rate_limit_ms : 1000;

    if (options.icon_url || options.iconUrl) {
      this.icon_url = options.icon_url || options.iconUrl;
    }

    if (options.icon_emoji || options.iconEmoji) {
      this.icon_emoji = options.icon_emoji || options.iconEmoji;
    }

    if (options.channel) {
      this.channel = options.channel;
    }

    if (options.username) {
      this.username = options.username;
    }

  }
}

const nameFromLevel = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal'
};

BunyanSlack.prototype.write = function write(record) {
  const self = this;
  let levelName;
  let message;
  let url;

  if (typeof record === 'string') {
    record = JSON.parse(record);
  }

  levelName = nameFromLevel[record.level];

  try {
    message = self.customFormatter ? self.customFormatter(record, levelName) : {
      text: util.format('[%s] %s', levelName.toUpperCase(), record.msg)
    };
  } catch(err) {
    return self.error(err);
  }
  const base = {
    channel: self.channel,
    username: self.username,
    icon_url: self.icon_url,
    icon_emoji: self.icon_emoji
  };

  message = { ...base, ...message };

  if (message.text.length >= 5000) {
    message.text = `${message.text.substring(0, 4000)}\n..................\n${message.text.slice(-1000)}`;
  }

  if ('string' === typeof self.webhook_url) {
    url = self.webhook_url;
  } else if (self.webhook_url.backyard && record.domain === 'backyard.kailsh-tech.jp') {
    url = self.webhook_url.backyard;
  } else if (Object(self.webhook_url) === self.webhook_url) {
    if ('error' === levelName && self.webhook_url.error || 'fatal' === levelName && self.webhook_url.fatal) {
      url = self.webhook_url.error;
    } else if (record.webhook && self.webhook_url[record.webhook]) {
      url = self.webhook_url[record.webhook];
    } else if (self.webhook_url.default) {
      url = self.webhook_url.default;
    }
  }
  if (!url) {
    return;
  }

  if (!tryAcquireWebhookPost(url, self.webhook_rate_limit_ms)) {
    return;
  }

  fetch(url, {
    method: 'POST',
    body: JSON.stringify(message),
    headers: {
      'Content-Type': 'application/json',
    },
  }).catch(err => {
    return self.error(err);
  });
};

module.exports = BunyanSlack;
