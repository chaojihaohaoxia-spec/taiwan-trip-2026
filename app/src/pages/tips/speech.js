// =====================================================================
// pages/tips/speech.js：常用语「读出来」——用系统自带的语音（Web Speech API 的 speechSynthesis，不联网）。
//
//   const speech = useSpeech();
//   speech.can('vi')            这台设备有没有越南语的声音（iPhone 自带「Linh」；没有就不显示读出来的按钮）
//   speech.speak(text, 'vi')    读；再点一下同一句 = 停
//   speech.speaking             正在读的那一句（文字），没有为 null
//
// 只有找得到这种语言的声音才算能读：拿英文声音念越南语是乱的，不如不给按钮。
// 声音列表在 iOS / Chrome 上可能一开始是空的，要等 voiceschanged 再看一次。
// 以后 iOS 测试版 App 的外壳可以接管（AVSpeechSynthesizer），页面代码不用改：只用这里的 can / speak。
// =====================================================================

import { useEffect, useState, useCallback } from 'preact/hooks';

function synth() {
  return typeof window !== 'undefined' && window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function'
    ? window.speechSynthesis
    : null;
}

/** 'vi' / 'vi-VN' → 'vi' */
export function baseLang(lang) {
  return String(lang || '').trim().toLowerCase().split(/[-_]/)[0] || '';
}

/**
 * 在声音列表里挑这种语言的：完全一样的（vi-VN）优先，再要同一种语言的（vi-*）；本机声音优先（不联网）。
 * @param {Array<{ lang: string, localService?: boolean, default?: boolean }>} voices
 * @param {string} lang
 */
export function pickVoice(voices, lang) {
  const want = String(lang || '').toLowerCase().replace('_', '-');
  const base = baseLang(want);
  if (!base) return null;
  const same = (voices || []).filter((v) => baseLang(v.lang) === base);
  if (!same.length) return null;
  const exact = same.filter((v) => String(v.lang).toLowerCase().replace('_', '-') === want);
  const pool = exact.length ? exact : same;
  return pool.find((v) => v.localService) || pool.find((v) => v.default) || pool[0];
}

export function useSpeech() {
  const [voices, setVoices] = useState(() => synth()?.getVoices?.() || []);
  const [speaking, setSpeaking] = useState(null);

  useEffect(() => {
    const s = synth();
    if (!s) return undefined;
    const update = () => setVoices(s.getVoices?.() || []);
    update();
    s.addEventListener?.('voiceschanged', update);
    return () => {
      s.removeEventListener?.('voiceschanged', update);
      // 离开页面就别再读了
      try {
        s.cancel();
      } catch {
        /* 没关系 */
      }
    };
  }, []);

  const can = useCallback((lang) => Boolean(synth() && pickVoice(voices, lang)), [voices]);

  const speak = useCallback((text, lang) => {
    const s = synth();
    const voice = pickVoice(voices, lang);
    if (!s || !voice || !text) return false;
    try {
      s.cancel();
      if (speaking === text) {
        setSpeaking(null);
        return true;
      }
      const u = new window.SpeechSynthesisUtterance(String(text));
      u.voice = voice;
      u.lang = voice.lang;
      // 慢一点，给对方、也给自己听清楚
      u.rate = 0.85;
      u.onend = () => setSpeaking((cur) => (cur === text ? null : cur));
      u.onerror = () => setSpeaking((cur) => (cur === text ? null : cur));
      setSpeaking(text);
      s.speak(u);
      return true;
    } catch {
      setSpeaking(null);
      return false;
    }
  }, [voices, speaking]);

  return { can, speak, speaking };
}
