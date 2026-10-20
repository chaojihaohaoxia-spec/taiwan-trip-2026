// =====================================================================
// lib/translate/listen.js：对话模式里「直接说」——浏览器自带的语音识别（Web Speech API 的 SpeechRecognition）。
//
//   canListen()                          这台手机能不能直接听（触屏 + 有 SpeechRecognition / webkitSpeechRecognition；
//                                        这次打开里被拒绝过麦克风就不再试）
//   const h = listen({ lang, onText, onEnd })   开始听：lang 'vi-VN' / 'zh-CN'；
//     onText(text, final)  边听边出字（final = 这一句说完了）
//     onEnd(reason)        停了：'done'（说完自动停）/ 'stop'（我们叫停的）/ 'quiet'（没听到）/ 'denied'（没给麦克风）/ 'fail'
//   h.stop()                             叫停（已经听到的字照样交出来）
//
// iOS Safari 14.5+ 有 webkitSpeechRecognition（要开「听写」）；主屏 App 模式里可能没有或者用不了——
// 用不了就退回原来的键盘方式（ConverseSheet 里切到打字），所以这里一律不抛错。
// 不自己连网：识别是系统 / 浏览器做的（和键盘上的话筒一样）。
// =====================================================================

let denied = false;

function ctor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/** 能不能直接听（桌面不用：有键盘，浏览器的识别还要把声音发到别处） */
export function canListen({ coarse = true } = {}) {
  return Boolean(!denied && coarse && ctor());
}

/** 测试用 */
export function resetListen() {
  denied = false;
}

/**
 * @param {{ lang: string, onText?: (text: string, final: boolean) => void, onEnd?: (reason: string) => void }} o
 * @returns {{ stop: () => void }}
 */
export function listen({ lang, onText, onEnd }) {
  const C = ctor();
  let ended = false;
  const end = (reason) => {
    if (ended) return;
    ended = true;
    onEnd?.(reason);
  };
  if (!C) {
    end('fail');
    return { stop() {} };
  }
  let rec;
  try {
    rec = new C();
  } catch {
    end('fail');
    return { stop() {} };
  }
  let heard = '';
  let stopped = false;
  let error = '';
  rec.lang = lang;
  rec.interimResults = true;
  // 一句说完自动停（像苹果翻译的面对面：说完就翻），要接着说再点一次
  rec.continuous = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    let text = '';
    let final = false;
    for (let i = 0; i < e.results.length; i += 1) {
      const r = e.results[i];
      text += r[0]?.transcript || '';
      if (r.isFinal) final = true;
    }
    heard = text.trim();
    if (heard) onText?.(heard, final && !stopped);
  };
  rec.onerror = (e) => {
    error = String(e?.error || 'fail');
    if (error === 'not-allowed' || error === 'service-not-allowed') denied = true;
  };
  rec.onend = () => {
    if (error === 'not-allowed' || error === 'service-not-allowed') end('denied');
    else if (error === 'no-speech' || (!heard && !error && !stopped)) end('quiet');
    else if (error && error !== 'aborted' && !heard) end('fail');
    else end(stopped ? 'stop' : 'done');
  };
  try {
    rec.start();
  } catch {
    end('fail');
    return { stop() {} };
  }
  return {
    stop() {
      if (ended || stopped) return;
      stopped = true;
      try {
        rec.stop();
      } catch {
        end('stop');
      }
    },
  };
}
