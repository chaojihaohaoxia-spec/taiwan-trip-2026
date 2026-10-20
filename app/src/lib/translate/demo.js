// =====================================================================
// lib/translate/demo.js：演示模式（本机 ?demo=1）的假翻译接口：不连网，只认得几句（实测 hy3 的译文），别的句子给一段「示例翻译」。
//
//   createDemoFetch({ delay }) → fetch(url, init)：和真接口一样收 POST text/plain 的 JSON { text, token, trip, warm }，
//   回 { status, json() }，返回体和 translate-web 一样（{ ok, src, vi, en, back, zh, demo }）。所以页面走的是同一套 client.js。
//   原文开头是「大哥，」「阿姨，」这类称呼：越南语句首换成 Anh ơi / Cô ơi，回译也带上。
// =====================================================================

const OUT = [
  ['请问夜市怎么走？走路远吗？', 'Cho tôi hỏi chợ đêm đi sao ạ? Đi bộ có xa không ạ?', 'Excuse me, how do I get to the night market? Is it far to walk?', '请问夜市怎么走？走路远吗？'],
  ['不要香菜，我们不吃海鲜。', 'Không cho ngò nha, tụi tôi không ăn hải sản.', "No cilantro, please. We don't eat seafood.", '别放香菜哦，我们不吃海鲜。'],
  ['师傅，去这个地址，到了在大门口停就行。', 'Anh ơi, chở tôi tới địa chỉ này, dừng ở cổng chính là được ạ.', 'Please take me to this address and stop at the main gate.', '师傅，载我去这个地址，在正门停就可以了。'],
  ['我们已经退房了，行李能寄存到下午四点吗？', 'Tụi tôi đã trả phòng rồi, gửi hành lý tới 4 giờ chiều được không ạ?', "We've checked out. Could we leave our luggage here until 4 pm?", '我们已经退房了，行李寄存到下午 4 点可以吗？'],
  ['附近哪里有 ATM 可以取钱？', 'Gần đây có cây ATM nào rút tiền được không ạ?', 'Is there an ATM nearby where I can withdraw cash?', '这附近有能取钱的 ATM 吗？'],
  ['太贵了，便宜一点吧，两个三十万行不行？', 'Mắc quá, bớt chút đi, hai cái 300 ngàn được không ạ?', "That's too expensive. Could you do two for 300,000?", '太贵了，便宜点吧，两个 30 万越南盾行吗？'],
  ['我有点拉肚子，附近有药店吗？', 'Tôi bị tiêu chảy chút, gần đây có tiệm thuốc không ạ?', 'I have a bit of diarrhea. Is there a pharmacy nearby?', '我有点拉肚子，附近有药店吗？'],
  ['请问你们几点关门？', 'Cho tôi hỏi tiệm mấy giờ đóng cửa ạ?', 'What time do you close?', '请问店几点关门？'],
  ['可以帮我们拍张照吗？把后面的海也拍进去。', 'Chụp giùm tụi tôi một tấm được không ạ? Chụp luôn cả biển phía sau nha.', 'Could you take a photo of us, with the sea behind us in it?', '帮我们拍一张可以吗？把后面的海也一起拍进去哦。'],
  ['不要放辣，一点都不要。', 'Không cho ớt nha, một chút cũng không được.', 'No chili, please, not even a little.', '别放辣椒哦，一点都不行。'],
  ['这个虾多少钱一公斤？帮我们挑两斤活的。', 'Tôm này bao nhiêu tiền một ký ạ? Chọn giùm tụi tôi 1 ký tôm sống nha.', 'How much is this shrimp per kg? Please pick 1 kg of live ones for us.', '这虾一公斤多少钱？帮我们挑 1 公斤活虾哦。'],
  ['我对花生过敏，菜里不能有花生和花生油。', 'Tôi bị dị ứng đậu phộng, món ăn không được có đậu phộng và dầu đậu phộng nha.', "I'm allergic to peanuts. No peanuts or peanut oil in the food, please.", '我对花生过敏，菜里不能有花生和花生油哦。'],
  ['我们两个人，有海边的位子吗？', 'Tụi tôi hai người, còn bàn gần biển không ạ?', 'Table for two, please. Do you have one by the sea?', '我们两个人，还有靠海的桌子吗？'],
  ['这个多少钱？', 'Cái này bao nhiêu tiền ạ?', 'How much is this?', '这个多少钱？'],
];
const IN = [
  ['Dạ, chờ em một chút nha.', '好的，稍等我一下哦。'],
  ['Anh ơi, tới rồi nha. 150 ngàn.', '到了哦，15 万越南盾。'],
  ['Sorry, we are fully booked tonight.', '不好意思，今晚已经订满了。'],
  ['Dạ cái này 150 ngàn một ký, tươi lắm chị ơi.', '这个一公斤 15 万越南盾，很新鲜的。'],
  ['Anh chị ăn ở đây hay mang về?', '你们在这儿吃还是打包？'],
];
const TITLES = { 大哥: 'Anh ơi', 大姐: 'Chị ơi', 小妹: 'Em ơi', 阿姨: 'Cô ơi', 叔叔: 'Chú ơi' };
const SAMPLE = {
  vi: 'Đây là bản dịch mẫu, chưa dịch thật.',
  en: 'This is a sample, not a real translation.',
  back: '这是示例翻译，没有真的翻。',
  zh: '（演示模式：只认得几句，没有真的翻）',
};

function keyOf(s) {
  return String(s || '').replace(/\s+/g, '').replace(/[，。？！、,.?!]/g, '').toLowerCase();
}
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** 假翻译（纯函数）：中文 → 越南语 + 英语 + 回译；外文 → 中文 */
export function demoTranslate(input) {
  const raw = String(input || '').trim();
  if (/[㐀-鿿]/.test(raw)) {
    let rest = raw;
    let title = '';
    for (const t of Object.keys(TITLES)) {
      if (!title && rest.startsWith(`${t}，`)) {
        title = t;
        rest = rest.slice(t.length + 1);
      }
    }
    const hit = OUT.find((x) => keyOf(x[0]) === keyOf(rest));
    if (!hit) return { ok: true, src: 'zh', vi: SAMPLE.vi, en: SAMPLE.en, back: SAMPLE.back, zh: '', demo: true };
    const [, vi0, en, back0] = hit;
    const vi = title && !/ơi,/.test(vi0) ? `${TITLES[title]}, ${lower(vi0)}` : vi0;
    const back = title && vi !== vi0 ? `${title}，${back0}` : back0;
    return { ok: true, src: 'zh', vi, en, back, zh: '' };
  }
  const hit = IN.find((x) => keyOf(x[0]) === keyOf(raw));
  if (!hit) return { ok: true, src: 'other', vi: '', en: '', back: '', zh: SAMPLE.zh, demo: true };
  return { ok: true, src: /[À-ỹ]/.test(raw) ? 'vi' : 'en', vi: '', en: '', back: '', zh: hit[1] };
}

/** 演示接口：fetch 的样子（init.signal 作废时 reject AbortError） */
export function createDemoFetch({ delay = 420 } = {}) {
  return (url, init = {}) => new Promise((resolve, reject) => {
    let body = null;
    try { body = JSON.parse(init.body || 'null'); } catch { body = null; }
    const reply = (status, json) => resolve({ status, json: async () => json });
    const t = setTimeout(() => {
      if (!body || typeof body !== 'object') return reply(400, { ok: false, code: 'bad_request', error: '不允许的调用' });
      if (!body.token) return reply(401, { ok: false, code: 'no_token', error: '先登录' });
      if (body.warm) return reply(200, { ok: true, warm: true, cold: 0 });
      const text = String(body.text || '').trim();
      if (!text) return reply(200, { ok: false, code: 'empty', error: '先写一句' });
      return reply(200, { ...demoTranslate(text), model: 'demo', cold: 0 });
    }, body?.warm ? 0 : delay);
    init.signal?.addEventListener?.('abort', () => {
      clearTimeout(t);
      const e = new Error('aborted');
      e.name = 'AbortError';
      reject(e);
    }, { once: true });
  });
}
