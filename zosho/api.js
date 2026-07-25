/**
 * GAS の JSON API への通信層。
 *
 * 画面側のコードは GAS 版の google.script.run をそのまま使い続けられるよう、
 * 同じ形（withSuccessHandler / withFailureHandler / メソッド呼び出し）を
 * fetch の上に用意している。これにより UI 側の書き換えが要らない。
 *
 * 接続先と接続キーは端末の localStorage に保存する。
 * 初回だけ URL の #setup=... で受け取るか、設定画面から入力する。
 */
'use strict';

(function () {
  var LS_KEY = 'zoshoConfig';
  var config = null;

  // ---------------------------------------------------------------
  // 設定の読み書き
  // ---------------------------------------------------------------
  function readStored() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function store(cfg) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) { /* 保存できなくても動く */ }
    config = cfg;
  }

  // 「#setup=...」を含む文字列から接続設定を取り出す。
  // 設定リンクをそのまま貼り付けられるよう、URL全体でも受け付ける。
  function parseSetup(text) {
    var m = String(text || '').match(/setup=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    try {
      var b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      var cfg = JSON.parse(decodeURIComponent(escape(atob(b64))));
      if (cfg && cfg.id && cfg.key) return { id: String(cfg.id), key: String(cfg.key) };
    } catch (e) { /* 壊れていたら無視 */ }
    return null;
  }

  function fromHash() {
    return parseSetup(location.hash);
  }

  function endpoint() {
    return 'https://script.google.com/macros/s/' + config.id + '/exec';
  }

  config = fromHash() || readStored();
  if (fromHash()) store(config);
  // URLのハッシュは消さない。
  // iOSではホーム画面から起動したアプリがSafariと別の保存領域を持つため、
  // 設定リンクが手元に残っていないと、そちらで設定し直せなくなる。

  // ---------------------------------------------------------------
  // 呼び出し
  // ---------------------------------------------------------------
  function call(action, args) {
    if (!config) return Promise.reject(new Error('接続先が未設定です'));
    return fetch(endpoint(), {
      method: 'POST',
      // text/plain にすることでプリフライト(OPTIONS)を起こさない。
      // GAS は OPTIONS に応答できないため、application/json では必ず失敗する。
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: config.key, action: action, args: args || {} })
    }).then(function (res) {
      if (!res.ok) throw new Error('通信エラー (HTTP ' + res.status + ')');
      return res.json();
    }).then(function (json) {
      if (!json.ok) throw new Error(json.error || '不明なエラー');
      return json.data;
    });
  }

  // 画面側の呼び出し形（引数の並び）をAPIの引数名に対応づける
  var SIGNATURES = {
    ping: [],
    pingServer: [], pingSheetInfo: [], pingRawRead: [],
    pingMapRows: [], pingCache: [], pingLock: [],
    getAllBooks: ['force'],
    getAllLabels: [],
    addBook: ['book'],
    updateBook: ['book'],
    deleteBook: ['id'],
    checkDuplicateIsbn: ['isbn'],
    lookupIsbn: ['isbn'],
    searchBooks: ['query'],
    getStatistics: [],
    importCsv: ['csvText'],
    getLastEditTime: [],
    getSpreadsheetUrl: [],
    setupEditTrigger: []
  };

  function makeRunner() {
    var runner = {};
    var onSuccess = null;
    var onFailure = null;
    runner.withSuccessHandler = function (fn) { onSuccess = fn; return runner; };
    runner.withFailureHandler = function (fn) { onFailure = fn; return runner; };

    Object.keys(SIGNATURES).forEach(function (action) {
      runner[action] = function () {
        var names = SIGNATURES[action];
        var args = {};
        for (var i = 0; i < names.length; i++) args[names[i]] = arguments[i];
        call(action, args).then(
          function (data) { if (onSuccess) onSuccess(data); },
          function (err) { if (onFailure) onFailure(err); }
        );
      };
    });
    return runner;
  }

  // 検証用ハーネスが先にスタブを入れている場合は上書きしない
  // （設定まわり zoshoConfig は常に用意する必要があるので、ここで return しない）
  if (!(window.google && window.google.script)) {
    window.google = {
      script: {
        get run() { return makeRunner(); },
        host: { close: function () {}, setHeight: function () {} }
      }
    };
  }

  // 画面側から設定状態を扱えるようにする
  window.zoshoConfig = {
    isSet: function () { return !!config; },
    get: function () { return config ? { id: config.id, key: config.key } : null; },
    save: function (id, key) {
      // 設定リンクをそのまま貼られた場合は、それだけで両方を取り出す
      var fromLink = parseSetup(id) || parseSetup(key);
      if (fromLink) {
        store(fromLink);
        return true;
      }
      var cleanId = String(id || '').trim();
      // WebアプリのURLを貼られても拾えるようにする
      var m = cleanId.match(/\/macros\/s\/([A-Za-z0-9_-]+)\//);
      if (m) cleanId = m[1];
      if (!cleanId || !String(key || '').trim()) return false;
      store({ id: cleanId, key: String(key).trim() });
      return true;
    },
    parseSetup: parseSetup,
    clear: function () {
      try { localStorage.removeItem(LS_KEY); } catch (e) { /* 無視 */ }
      config = null;
    },
    test: function () { return call('ping', {}); }
  };
})();
