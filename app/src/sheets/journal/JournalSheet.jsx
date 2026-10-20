// =====================================================================
// sheets/journal/JournalSheet.jsx：弹层「journal」——写日记 / 拍照打卡（SPEC §5.8）。
//
//   openJournalSheet({ date, mode: 'text' | 'photo', itemId, placeId }, { keyboard: true })
//     date   写哪一天（没有：从 itemId 推；再没有：进行中 → 今天、已结束 → 最后一个还没写的、出发前 → 第一天）
//     mode   'photo' = 拍照打卡（照片区在最上面；外壳 ＋ 面板、页面的「拍照打卡」按钮已经把拍好的照片放进
//            capture.js 的中转站时，面板一打开就开始压缩、上传），'text' = 写日记（正文自动聚焦）
//
// 每天每人一篇：这一天我已经写过就是编辑，没写就新建（store.saveJournal 自己判断；两台设备离线各写了同一天由
// 数据层合并）。只读成员也能写自己的日记（个人内容表，docs/数据结构.md A4）。
//
// 表单：心情（一排 emoji，再点一下取消）、正文（自动增高）、照片（拍照 / 从相册选，多选；lib/image.js 压缩、
// 按 EXIF 摆正；store.upload 进写队列 → 私有桶，离线排队；每张显示 处理中 / 上传中 / 排队 / 联网后上传 / 失败·重试）。
// 草稿：每改一下（防抖 400ms）存一份到这台设备（draft.js），面板卸载时防抖里的最后几个字也落盘——
//   往下拉关掉、返回手势、切到别的 App 都不丢，下次打开同一天接着写；所以关闭不再问「放弃未保存的内容？」。
//   保存成功后草稿删掉。
// 文件：从日记里去掉的照片，保存成功后把私有桶里的文件也删掉；这次会话新传、又去掉的立刻删；删整篇日记时
//   等撤销窗口过了（删除真的发出去）再删文件，撤销回来照片还在。
// 保存：底部 SubmitButton（文字 → 转圈 → 对勾）：await r.saved（离线也成功，改动进写队列），对勾描完关面板。
// 纯逻辑在 form.js（Node 里测），照片选择按钮在 PhotoInput.jsx。
// =====================================================================

import './journal-sheet.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Sheet, closeOverlay, useOverlay, toast, confirm } from '../../overlay/index.js';
import { data, authState, online, useSignedUrl } from '../../data/index.js';
import { route } from '../../router/index.js';
import { formatDate, formatInstant } from '../../lib/datetime.js';
import { haptic } from '../../lib/native.js';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { Button } from '../../ui/Button.jsx';
import { Spinner } from '../../ui/Spinner.jsx';
import { Skeleton } from '../../ui/Skeleton.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { useSheetArgs, useSheetTrip } from '../hooks.js';
import { parseSheetArg } from '../args.js';
import { PhotoInput } from './PhotoInput.jsx';
import { takeStashedPhotos } from './capture.js';
import { readDraft, writeDraft } from './draft.js';
import {
  moodOptions, moodLabel, defaultJournalDay, formFromEntry, applyDraft, carryNewPhotos, formIsDirty, formIsEmpty, formPatch, cleanPhoto,
  uploadStateOf, UPLOAD_LABELS, charCount, tripReady,
} from './form.js';

/** 草稿自动保存的防抖（毫秒） */
const DRAFT_DEBOUNCE_MS = 400;
/** 正文最多多少字（数据库没有限制；这里只是防止误粘贴一整本书） */
const BODY_MAX = 5000;

let seq = 0;

/** 网址里 journal 弹层的参数（在 Sheet 外面也能读：标题、底部按钮要用） */
function journalArgs() {
  const r = route.value;
  const layer = r?.sheets?.find((s) => s.id === 'journal');
  return parseSheetArg(layer?.arg ?? null);
}

export default function JournalSheet() {
  const { fields } = journalArgs();
  const photoMode = fields.mode === 'photo';
  const controller = useRef({ save: null });
  const [status, setStatus] = useState({ empty: true, busy: false, editing: false, dayLabel: '', ready: false });

  const footer = (
    <div class="jn-f__foot">
      {status.busy && <p class="jn-f__foot-hint" role="status">照片还在处理，稍等一下再保存</p>}
      <SubmitButton
        block
        label={status.editing ? '保存修改' : photoMode ? '保存打卡' : '保存日记'}
        loadingLabel="正在保存"
        successLabel="已保存"
        disabled={!status.ready || status.empty || status.busy}
        action={() => controller.current.save?.()}
        onSuccess={() => closeOverlay('journal', { force: true })}
        data-testid="journal-save"
      />
    </div>
  );

  return (
    <Sheet
      sheetId="journal"
      title={photoMode ? '拍照打卡' : status.editing ? '编辑日记' : '写日记'}
      description={status.dayLabel || undefined}
      detents={['content', 'large']}
      footer={footer}
      testId="journal-sheet"
    >
      <JournalForm controller={controller} onStatus={setStatus} photoMode={photoMode} />
    </Sheet>
  );
}

/**
 * 一张新照片现在的上传状态：写队列里的位置 + 服务器确认的结果（synced）。
 * 在组件里调用：订阅写队列状态和联网状态，变了自动重画。
 */
function useUploadStates(paths, results) {
  const q = data.outbox.state.value;
  const on = online.value;
  const out = new Map();
  for (const p of paths) {
    const r = results.get(p);
    if (r && r.ok === false) {
      out.set(p, r.cancelled ? 'done' : 'failed');
      continue;
    }
    out.set(p, uploadStateOf(p, { ops: data.outbox.ops, sending: q.sending, failedId: q.failed?.id || null, online: on }));
  }
  return out;
}

function JournalForm({ controller, onStatus, photoMode }) {
  const ov = useOverlay();
  const { fields } = useSheetArgs();
  const { tripId, store, pending: tripPending } = useSheetTrip();
  const me = authState.value.user?.id || null;
  const ready = tripReady(store);
  const trip = store?.trip.value || null;
  const timeZone = trip?.timezone;
  const days = store?.view.days.value || [];
  const dayByDate = store?.view.dayByDate.value;
  const byDay = store?.view.journalByDay.value;
  const phase = store?.view.phase.value?.phase || null;
  const todayDate = store?.view.today.value?.day?.date || null;
  const items = store?.tables.items.value;
  const places = store?.tables.places.value;

  /** 我在每一天写的日记（day id → 行） */
  const mineByDay = useMemo(() => {
    const m = new Map();
    if (!byDay || !me) return m;
    for (const [dayId, list] of byDay) {
      const e = list.find((x) => x.user_id === me);
      if (e) m.set(dayId, e);
    }
    return m;
  }, [byDay, me]);

  // ---------- 哪一天 ----------
  // 第一次拿到行程数据就在渲染里定下来（不等 effect）：从页面打开时数据早就在，第一帧画的就是完整表单，
  // 底部面板量到的内容高度才是对的（先画骨架再换成表单，面板会停在骨架那么矮）。定过一次就不再自动换
  // （保存以后“最后一个没写的天”变了也不跳到别的天），用户在日期条上点的另算。
  const autoDay = useRef(null);
  if (!autoDay.current && ready && days.length) {
    let want = null;
    if (fields.date && dayByDate?.get(fields.date)) want = dayByDate.get(fields.date);
    if (!want && fields.item) {
      const it = items?.get(fields.item);
      if (it?.day_id) want = days.find((d) => d.id === it.day_id) || null;
    }
    if (!want) want = defaultJournalDay({ days, phase, todayDate, mine: new Set(mineByDay.keys()) });
    autoDay.current = want?.id || null;
  }
  const [pickedDayId, setDayId] = useState(null);
  const dayId = pickedDayId || autoDay.current;
  const day = days.find((d) => d.id === dayId) || null;
  const dayIndex = day ? days.indexOf(day) : -1;
  const entry = dayId ? mineByDay.get(dayId) || null : null;

  // ---------- 表单 ----------
  const [form, setForm] = useState(null);
  const [restored, setRestored] = useState(false);
  /** 还在压缩的照片（还没有 path）：{ key, preview, name, state: 'processing'|'error', error } */
  const [processing, setProcessing] = useState([]);
  /** 这次会话里新上传的照片 path → synced 的结果（null = 还没确认） */
  const [results, setResults] = useState(new Map());
  const baseRef = useRef(formFromEntry(null));
  const entryRef = useRef(null);
  const loadedForDay = useRef(null);
  const closedRef = useRef(false);
  const previews = useRef(new Map());
  const bodyRef = useRef(null);
  const daysRef = useRef(null);
  const moodsRef = useRef(null);
  const [error, setError] = useState('');

  // 换了哪一天（或第一次拿到数据）：已有的日记 + 本机草稿 → 表单
  useEffect(() => {
    if (!dayId || !ready || loadedForDay.current === dayId) return;
    loadedForDay.current = dayId;
    const base = formFromEntry(entry);
    baseRef.current = base;
    entryRef.current = entry;
    const r = applyDraft(base, readDraft(tripId, me, dayId));
    setForm(r.form);
    setRestored(r.restored);
    setProcessing([]);
  }, [dayId, ready]);

  // 对方 / 另一台设备改了这一天我的日记（比如合并）：底稿跟着换，“有没有改动”才算得对
  useEffect(() => {
    if (!form || !entry || entryRef.current === entry) return;
    entryRef.current = entry;
    const base = formFromEntry(entry);
    if (!formIsDirty(form, baseRef.current)) setForm(base);
    else {
      // 改到一半，别处往这天的日记里加了照片（补照片）：并进来，保存时不会把它们去掉、删文件
      const oldPhotos = baseRef.current?.photos || [];
      setForm((f) => (f ? { ...f, photos: carryNewPhotos(f.photos, oldPhotos, base.photos) } : f));
    }
    baseRef.current = base;
  }, [entry]);

  // 草稿自动保存（防抖）；面板卸载时把防抖还没到的最后几个字也落盘（见下面的卸载 effect）
  const latest = useRef(null);
  latest.current = { form, dayId, tripId, me };
  useEffect(() => {
    if (!form || !dayId || closedRef.current) return undefined;
    const t = setTimeout(() => {
      if (closedRef.current) return;
      writeDraft(tripId, me, dayId, formIsDirty(form, baseRef.current) ? form : null, baseRef.current);
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [form, dayId]);

  // 拍照打卡：中转站里的照片（页面 / ＋ 面板叫相机拍的）面板一打开就开始传
  useEffect(() => {
    if (!form || !store) return;
    const stashed = takeStashedPhotos();
    if (stashed.length) ov.whenOpened().then(() => addFiles(stashed));
  }, [Boolean(form), Boolean(store)]);

  // 写日记：正文自动聚焦（openOverlay 的 keyboard 选项先叫出键盘，data-autofocus 接过焦点）
  useEffect(() => {
    if (!form || photoMode) return;
    const el = bodyRef.current;
    const a = document.activeElement;
    const idle = !a || a === document.body || a.classList?.contains('ov-keyboard-proxy') || a.classList?.contains('ov-sheet__title');
    if (el && !el.value && idle) el.focus({ preventScroll: true });
  }, [Boolean(form)]);

  // 卸载（往下拉关掉、返回手势、切页）：保存 / 删除以外的关闭先把草稿落盘——刚打的最后几个字还在防抖里，不能丢；
  // 然后释放本机预览
  useEffect(() => () => {
    const l = latest.current;
    if (!closedRef.current && l?.form && l.dayId) writeDraft(l.tripId, l.me, l.dayId, formIsDirty(l.form, baseRef.current) ? l.form : null, baseRef.current);
    closedRef.current = true;
    for (const u of previews.current.values()) URL.revokeObjectURL?.(u);
    previews.current.clear();
  }, []);

  const update = (patch) => setForm((f) => (f ? { ...f, ...patch } : f));

  // 选中的那一天滚到日期条中间、选中的心情滚进来（只滚那一行，不动面板和页面）
  const centerIn = (row, el) => {
    if (!row || !el) return;
    row.scrollTo({ left: el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2, behavior: 'instant' });
  };
  useEffect(() => {
    centerIn(daysRef.current, daysRef.current?.querySelector('[aria-checked="true"]'));
  }, [dayId, Boolean(form)]);
  useEffect(() => {
    const row = moodsRef.current;
    const el = row?.querySelector('[aria-checked="true"]');
    if (!row || !el) return;
    // 已经看得见就不动（用户点的时候不要跳）
    const left = el.offsetLeft - row.scrollLeft;
    if (left < 0 || left + el.offsetWidth > row.clientWidth) centerIn(row, el);
  }, [form?.mood, Boolean(form)]);

  // 正文框跟着内容长高：打开时已有的日记 / 恢复的草稿也要量一次（不只在打字时）
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [form?.body, Boolean(form)]);

  // 表单从骨架换成真内容、行数变了：overlay/Sheet 自己用 ResizeObserver 盯着内容区，面板跟着长高 / 变矮（不用再发 resize 事件）

  // ---------- 照片 ----------
  const addFiles = async (files) => {
    if (!store) return;
    for (const file of files) {
      seq += 1;
      const key = `p${seq}`;
      let preview = null;
      try {
        preview = URL.createObjectURL(file);
        previews.current.set(key, preview);
      } catch {
        preview = null;
      }
      setProcessing((p) => [...p, { key, preview, name: file.name, state: 'processing' }]);
      try {
        const r = await store.upload('journal', file);
        if (closedRef.current) return;
        const photo = cleanPhoto({ path: r.path, taken_at: r.takenAt || undefined, width: r.width || undefined, height: r.height || undefined });
        setForm((f) => (f ? { ...f, photos: [...f.photos, photo] } : f));
        setResults((m) => new Map(m).set(r.path, null));
        setProcessing((p) => p.filter((x) => x.key !== key));
        haptic('light');
        r.synced.then((res) => {
          if (closedRef.current) return;
          setResults((m) => (m.has(r.path) ? new Map(m).set(r.path, res) : m));
        });
      } catch (e) {
        if (closedRef.current) return;
        setProcessing((p) => p.map((x) => (x.key === key ? { ...x, state: 'error', error: e?.message || '这张照片打不开' } : x)));
      }
    }
  };

  const removeProcessing = (key) => {
    const u = previews.current.get(key);
    if (u) URL.revokeObjectURL?.(u);
    previews.current.delete(key);
    setProcessing((p) => p.filter((x) => x.key !== key));
  };

  const removePhoto = async (path) => {
    // 界面先去掉；这次会话里新传的照片：还没发出去的从写队列撤掉，已经发出去（或正在发）的把文件也删掉，
    // 私有桶里不留没人引用的文件。日记里原有的照片这里不删文件（没保存前还能反悔），保存成功后统一删（见 save）
    const isNew = results.has(path);
    setResults((m) => {
      const n = new Map(m);
      n.delete(path);
      return n;
    });
    update({ photos: (form?.photos || []).filter((p) => p.path !== path) });
    const op = data.outbox.ops.find((o) => o.kind === 'upload' && o.file?.path === path);
    let cancelled = false;
    if (op) {
      try {
        cancelled = await data.outbox.cancel(op.id);
      } catch {
        cancelled = false;
      }
    }
    if (isNew && !cancelled) removeFiles([path]);
  };

  /** 删掉私有桶里的文件（进写队列；失败不影响日记本身） */
  const removeFiles = (paths) => {
    if (!tripId || !paths.length) return;
    try {
      data.files.remove(tripId, paths);
    } catch {
      /* 删文件失败不影响日记 */
    }
  };

  const newPaths = useMemo(() => [...results.keys()], [results]);
  const uploadStates = useUploadStates(newPaths, results);
  const failedCount = [...uploadStates.values()].filter((s) => s === 'failed').length;
  const waitingCount = [...uploadStates.values()].filter((s) => s === 'offline').length;
  const uploadingCount = [...uploadStates.values()].filter((s) => s === 'uploading' || s === 'queued').length;

  // ---------- 保存 ----------
  controller.current.save = async () => {
    setError('');
    if (!store || !dayId || !form) throw new Error('还没准备好');
    if (processing.some((p) => p.state === 'processing')) throw new Error('照片还在处理，稍等一下');
    const current = entryRef.current;
    const patch = formPatch(form, current);
    if (current && !Object.keys(patch).length) {
      closedRef.current = true;
      writeDraft(tripId, me, dayId, null);
      return;
    }
    try {
      const r = store.saveJournal(dayId, patch);
      const saved = await r.saved;
      closedRef.current = true;
      writeDraft(tripId, me, dayId, null);
      // 从日记里去掉的原有照片：文件也删掉（写队列里排在这次修改后面；只会是自己目录里的）
      if (patch.photos) {
        const kept = new Set(patch.photos.map((p) => p.path));
        removeFiles((current?.photos || []).map((p) => p?.path).filter((p) => p && !kept.has(p)));
      }
      haptic('success');
      if (saved?.durable === false) toast.warning('这台设备的存储暂时不可用：日记只保存在内存里，关掉页面会丢');
      else if (!online.value) toast('离线中：日记先存在本机，联网后自动同步');
    } catch (e) {
      setError(e?.message || '没有保存成功，请稍后再试');
      throw e;
    }
  };

  const remove = async () => {
    const current = entryRef.current;
    if (!store || !current) return;
    const ok = await confirm({ title: '删除这篇日记？', message: '心情、正文和照片都会删掉，几秒内可以撤销。', confirmText: '删除', destructive: true });
    if (!ok) return;
    try {
      const res = store.remove('journal_entries', current.id, { undoMs: 6000, label: '删除日记' });
      closedRef.current = true;
      writeDraft(tripId, me, dayId, null);
      // 照片文件等删除真的发出去（撤销窗口过了、没被撤销）再删：撤销回来照片还在
      const paths = (current.photos || []).map((p) => p?.path).filter(Boolean);
      if (paths.length && res?.synced) res.synced.then((r) => r?.ok && removeFiles(paths)).catch(() => {});
      closeOverlay('journal', { force: true });
    } catch (e) {
      setError(e?.message || '没有删除成功');
    }
  };

  // ---------- 告诉外面（标题、底部按钮） ----------
  const busy = processing.some((p) => p.state === 'processing');
  const dayLabel = day ? `D${dayIndex + 1} · ${formatDate(day.date, { timeZone, relative: true })}${day.title ? ` · ${day.title}` : ''}` : '';
  useEffect(() => {
    onStatus({ empty: !form || formIsEmpty(form), busy, editing: Boolean(entry), dayLabel, ready: Boolean(form && ready) });
  }, [form, busy, Boolean(entry), dayLabel, ready]);

  // ---------- 换天 ----------
  const pickDay = (d) => {
    if (!d || d.id === dayId) return;
    // 当前这一天的草稿先落盘（防抖还没到也不丢）
    if (form) writeDraft(tripId, me, dayId, formIsDirty(form, baseRef.current) ? form : null, baseRef.current);
    loadedForDay.current = null;
    setDayId(d.id);
    haptic('selection');
  };

  // ---------- 渲染 ----------
  if (!ready || !form) {
    if (!tripPending && !store) return <p class="jn-f__empty" role="status">不在行程里，没法写日记。</p>;
    if (ready && !days.length) return <p class="jn-f__empty" role="status" data-testid="journal-form-nodays">这趟行程还没有分天，先在行程里定下日期。</p>;
    return (
      <div class="jn-f jn-f--loading" aria-busy="true">
        <span class="visually-hidden" role="status">正在读取…</span>
        <Skeleton variant="rect" height={52} radius="md" />
        <Skeleton variant="text" lines={3} />
      </div>
    );
  }

  const context = fields.item ? items?.get(fields.item) : fields.place ? places?.get(fields.place) : null;
  const contextName = context?.title || context?.name || '';

  const photoSection = (
    <section class="jn-f__sec" aria-labelledby="jn-f-photos">
      <h3 id="jn-f-photos" class="jn-f__label">
        照片
        {form.photos.length + processing.length > 0 && <span class="jn-f__count">{form.photos.length + processing.length} 张</span>}
      </h3>
      <div class="jn-f__pick">
        <PhotoInput camera onFiles={addFiles} variant={photoMode ? 'primary' : 'secondary'} testId="journal-camera">拍照</PhotoInput>
        <PhotoInput multiple onFiles={addFiles} testId="journal-pick">从相册选</PhotoInput>
      </div>
      {(form.photos.length > 0 || processing.length > 0) && (
        <ul class="jn-f__photos" data-testid="journal-photos">
          {form.photos.map((p) => (
            <PhotoTile
              key={p.path}
              photo={p}
              state={uploadStates.get(p.path) || null}
              preview={null}
              timeZone={timeZone}
              onRemove={() => removePhoto(p.path)}
              onRetry={failedCount ? () => data.retrySync() : null}
            />
          ))}
          {processing.map((p) => (
            <PhotoTile key={p.key} photo={null} preview={p.preview} state={p.state === 'error' ? 'error' : 'processing'} error={p.error} onRemove={() => removeProcessing(p.key)} />
          ))}
        </ul>
      )}
      {(failedCount > 0 || waitingCount > 0 || uploadingCount > 0) && (
        <p class={`jn-f__upnote${failedCount ? ' jn-f__upnote--danger' : ''}`} role="status" data-testid="journal-upload-note">
          {failedCount
            ? `${failedCount} 张没传上去，保存后会一直重试；也可以点照片上的「重试」`
            : waitingCount
              ? `${waitingCount} 张等联网后自动上传，现在保存也没问题`
              : `${uploadingCount} 张正在上传，可以先保存`}
        </p>
      )}
    </section>
  );

  const moodSection = (
    <section class="jn-f__sec" aria-labelledby="jn-f-mood">
      <h3 id="jn-f-mood" class="jn-f__label">
        心情
        {form.mood && <span class="jn-f__count">{moodLabel(form.mood)}</span>}
      </h3>
      <div class="jn-f__moods" role="radiogroup" aria-label="心情" data-testid="journal-moods" ref={moodsRef}>
        {moodOptions(form.mood).map((m) => {
          const on = form.mood === m.emoji;
          return (
            <button
              key={m.emoji}
              type="button"
              role="radio"
              aria-checked={on ? 'true' : 'false'}
              aria-label={m.label}
              class="jn-f__mood"
              data-press="scale"
              data-testid={`journal-mood-${m.emoji}`}
              onClick={() => {
                update({ mood: on ? '' : m.emoji });
                haptic('selection');
              }}
            >
              <span class="jn-f__emoji" aria-hidden="true">{m.emoji}</span>
              <span class="jn-f__mood-name">{m.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );

  const bodySection = (
    <section class="jn-f__sec" aria-labelledby="jn-f-body">
      <h3 id="jn-f-body" class="jn-f__label">
        正文
        {charCount(form.body) > 0 && <span class="jn-f__count">{charCount(form.body)} 字</span>}
      </h3>
      <textarea
        ref={bodyRef}
        class="jn-f__body"
        rows={photoMode ? 2 : 4}
        placeholder={photoMode ? '给这些照片写两句（可以不写）' : '今天的小事和心情……'}
        value={form.body}
        maxLength={BODY_MAX}
        data-autofocus={!photoMode ? '' : undefined}
        data-testid="journal-body"
        onInput={(e) => update({ body: e.currentTarget.value })}
      />
    </section>
  );

  return (
    <div class="jn-f" data-testid="journal-form" data-mode={photoMode ? 'photo' : 'text'}>
      {days.length > 1 && (
        <div class="jn-f__days" role="radiogroup" aria-label="写哪一天" data-testid="journal-days" ref={daysRef}>
          {days.map((d, i) => {
            const on = d.id === dayId;
            const written = mineByDay.has(d.id);
            return (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={on ? 'true' : 'false'}
                class="jn-f__day"
                data-press="scale"
                data-written={written ? '' : undefined}
                data-testid={`journal-day-${d.date}`}
                onClick={() => pickDay(d)}
              >
                <span class="jn-f__day-n t-serif">D{i + 1}</span>
                <span class="jn-f__day-d">{d.date === todayDate ? '今天' : formatDate(d.date, { timeZone, year: 'never' }).replace(/^(\d+)月(\d+)日/, '$1/$2')}</span>
                {written && <i class="jn-f__day-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}

      {contextName && (
        <p class="jn-f__context" data-testid="journal-context">
          <Glyph name={fields.item ? 'clock' : 'pin'} size={14} />
          关于「{contextName}」
        </p>
      )}

      {restored && (
        <p class="jn-f__restored" role="status" data-testid="journal-restored">
          <Glyph name="refresh" size={14} />
          已恢复上次没保存的草稿
        </p>
      )}

      {photoMode ? (
        <>
          {photoSection}
          {moodSection}
          {bodySection}
        </>
      ) : (
        <>
          {moodSection}
          {bodySection}
          {photoSection}
        </>
      )}

      {error && <p class="jn-f__error" role="alert" data-testid="journal-error">{error}</p>}

      {entry && (
        <div class="jn-f__danger">
          <Button variant="danger-soft" size="sm" onClick={remove} data-testid="journal-delete">删除这篇日记</Button>
          <span class="jn-f__saved-at">{entry.updated_at ? `上次保存 ${formatInstant(entry.updated_at, { timeZone, relative: true })}` : ''}</span>
        </div>
      )}
      <p class="jn-f__hint">草稿会自动保存</p>
    </div>
  );
}

/** 表单里的一张照片：缩略图 + 上传状态 + 去掉 */
function PhotoTile({ photo, preview, state, error, timeZone, onRemove, onRetry }) {
  const url = useSignedUrl(photo?.path || null) || preview;
  const [loaded, setLoaded] = useState(false);
  const label = state === 'error' ? (error || UPLOAD_LABELS.error) : state ? UPLOAD_LABELS[state] : '';
  const showLabel = state && state !== 'done';
  const taken = photo?.taken_at ? formatInstant(photo.taken_at, { timeZone, date: false }) : '';
  return (
    <li class="jn-f__photo" data-state={state || 'saved'} data-testid="journal-photo">
      <span class="jn-f__thumb">
        {url && <img src={url} alt="" draggable={false} decoding="async" onLoad={() => setLoaded(true)} data-loaded={loaded ? '' : undefined} />}
        {state === 'processing' && <span class="jn-f__thumb-veil"><Spinner size={22} label="处理中" /></span>}
        {(state === 'uploading' || state === 'queued') && <span class="jn-f__thumb-bar" aria-hidden="true"><i /></span>}
      </span>
      {showLabel && (
        <span class={`jn-f__photo-state${state === 'failed' || state === 'error' ? ' jn-f__photo-state--danger' : ''}`} title={label}>
          {state === 'failed' && onRetry ? (
            <button type="button" class="jn-f__photo-retry" onClick={onRetry} data-press="highlight">{label} · 重试</button>
          ) : label}
        </span>
      )}
      {!showLabel && taken && <span class="jn-f__photo-state t-label" aria-label={`拍摄时间 ${taken}`}>{taken}</span>}
      <button type="button" class="jn-f__photo-x" aria-label="去掉这张照片" data-press="scale" onClick={onRemove} data-testid="journal-photo-remove">
        <Glyph name="x" size={14} stroke={2.4} />
      </button>
    </li>
  );
}

