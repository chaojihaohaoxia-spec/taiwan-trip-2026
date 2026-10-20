// =====================================================================
// sheets/cover/CoverSheet.jsx：弹层「cover」——封面和主题色（sheets/index.js 的 openCoverSheet）。
//
//   最上面一张预览：3:2 的封面（照片；没有照片就是主题色 + 宋体首字，和行程列表的卡片一样）+ 宋体行程名，跟着下面的选择实时变；
//   封面照片：「从相册选」+ 这趟日记 / 评级里的照片（最多 12 张，按天），点一张选中；「不用照片」；
//   主题色：六个预设（现在的颜色不是预设时放最前面），两趟行程各用一种，克制地点缀在概览、卡片上。
// 保存：store.updateTrip({ cover })（乐观更新 + 写队列，离线也行）。从相册新选的照片先传到 covers/，没保存就关掉会删掉它；
// 换掉的旧封面如果是自己以前从这里传的、别处没用到，保存后也删掉（model.js 的 replacedCover）。
// 只读成员：只能看，说明「只有能编辑的成员能换」。
// =====================================================================

import './cover.css';
import { useMemo, useRef, useState } from 'preact/hooks';
import { Sheet, closeOverlay, toast } from '../../overlay/index.js';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { Spinner } from '../../ui/Spinner.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { data, useSignedUrl, authState } from '../../data/index.js';
import { haptic } from '../../lib/native.js';
import { PhotoInput } from '../journal/PhotoInput.jsx';
import { useSheetTrip } from '../hooks.js';
import { coverPhotos, colorChoices, coverForm, coverPatch, isCoverChanged, choiceStyle, replacedCover } from './model.js';

function Thumb({ path, selected, onPick, label }) {
  const url = useSignedUrl(path);
  return (
    <button
      type="button"
      class="cvs-thumb"
      role="radio"
      aria-checked={selected ? 'true' : 'false'}
      aria-label={label}
      data-press="scale"
      onClick={onPick}
    >
      {url ? <img src={url} alt="" loading="lazy" decoding="async" draggable={false} /> : <span class="cvs-thumb__ph" aria-hidden="true" />}
      {selected && <span class="cvs-thumb__check" aria-hidden="true"><Glyph name="check" size={14} stroke={2.8} /></span>}
    </button>
  );
}

function Preview({ trip, form, choice }) {
  const url = useSignedUrl(form.imagePath);
  const [title, ...rest] = String(trip?.title || '').split(' · ');
  return (
    <div class="cvs-preview accent-scope" style={choice ? choiceStyle(choice) : undefined} aria-hidden="true" data-testid="cover-preview">
      <div class="cvs-preview__media" data-photo={form.imagePath ? '' : undefined}>
        {form.imagePath ? (
          url ? <img src={url} alt="" decoding="async" draggable={false} /> : <Spinner size={20} />
        ) : (
          <span class="cvs-preview__initial">{title.slice(0, 1)}</span>
        )}
      </div>
      <div class="cvs-preview__text">
        <b>{title}</b>
        {rest.length > 0 && <span>{rest.join(' · ')}</span>}
      </div>
    </div>
  );
}

export default function CoverSheet() {
  const { tripId, store, pending } = useSheetTrip();
  const trip = store?.trip.value || null;
  const canEdit = store?.view.canEdit.value ?? false;
  const cover = trip?.cover || {};
  const [form, setForm] = useState(null);
  const [uploading, setUploading] = useState(false);
  const uploaded = useRef(new Set());
  const savedPath = useRef(null);
  const current = form || (trip ? coverForm(cover) : null);
  const days = store?.view.days.value || [];
  const journal = store ? [...store.tables.journal_entries.value.values()] : [];
  const reviews = store ? [...store.tables.reviews.value.values()] : [];
  const photos = useMemo(() => coverPhotos({ journal, reviews, days }), [store?.tables.journal_entries.value, store?.tables.reviews.value, days]);
  const choices = useMemo(() => colorChoices(cover), [cover.accent, cover.accent_2]);
  const set = (patch) => setForm({ ...current, ...patch });
  const dirty = Boolean(current && trip && isCoverChanged(cover, current));
  // 新选的照片如果还没在列表里，放在最前面
  const list = current?.imagePath && !photos.some((p) => p.path === current.imagePath) ? [{ path: current.imagePath }, ...photos] : photos;

  const pickFile = async (files) => {
    const file = files?.[0];
    if (!file || !store) return;
    setUploading(true);
    try {
      const r = await store.upload('covers', file);
      uploaded.current.add(r.path);
      set({ imagePath: r.path });
      haptic('light');
    } catch (e) {
      toast.error(e?.message || '这张照片打不开');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!store || !current) throw new Error('行程还没读出来');
    const oldPath = cover.image_path || null;
    const r = store.updateTrip({ cover: coverPatch(cover, current) });
    savedPath.current = current.imagePath;
    await r.saved;
    // 换掉的旧封面：自己以前从这里传的、日记和评级里都没用到 → 删掉文件（写队列里排在这次修改后面）
    const inUse = new Set([...journal, ...reviews].flatMap((x) => (x && !x.deleted_at ? (x.photos || []).map((p) => p?.path) : [])).filter(Boolean));
    const stale = replacedCover(oldPath, current.imagePath || null, { tripId, me: authState.value.user?.id || null, inUse });
    if (stale) {
      try {
        data.files.remove(tripId, [stale]);
      } catch {
        /* 删不掉不影响使用 */
      }
    }
  };

  const cleanup = () => {
    // 传了但没用上的封面（换了别的、没保存就关掉）删掉，私有桶里不留没人引用的文件
    const keep = savedPath.current || trip?.cover?.image_path || null;
    const orphans = [...uploaded.current].filter((p) => p !== keep);
    if (orphans.length && tripId) {
      try {
        data.files.remove(tripId, orphans);
      } catch {
        /* 删不掉不影响使用 */
      }
    }
    uploaded.current = new Set();
    savedPath.current = null;
    setForm(null);
  };

  return (
    <Sheet
      sheetId="cover"
      title="封面和颜色"
      detents={['large']}
      onClosed={cleanup}
      testId="sheet-cover"
      footer={canEdit && current ? (
        <SubmitButton
          block
          label="保存"
          loadingLabel="正在保存"
          successLabel="已保存"
          errorLabel="重试"
          disabled={!dirty || uploading}
          action={save}
          onSuccess={() => closeOverlay('cover', { force: true })}
          data-testid="cover-save"
        />
      ) : null}
    >
      {!trip || pending ? (
        <p class="cvs-note"><Spinner size={16} /> 正在读取行程…</p>
      ) : (
        <div class="cvs" data-testid="cover-form">
          <Preview trip={trip} form={current} choice={choices.find((c) => c.key === current.color)} />
          {!canEdit && <p class="cvs-note" data-testid="cover-readonly">只有能编辑这趟行程的成员能换封面和颜色。</p>}

          <section class="cvs-field" aria-labelledby="cvs-photo-label">
            <div class="cvs-field__head">
              <span class="cvs-label" id="cvs-photo-label">封面照片</span>
              {canEdit && current.imagePath && (
                <button type="button" class="cvs-link" data-press="scale" onClick={() => { haptic('selection'); set({ imagePath: null }); }} data-testid="cover-clear">不用照片</button>
              )}
            </div>
            <div class="cvs-grid" role="radiogroup" aria-labelledby="cvs-photo-label">
              {canEdit && (
                <PhotoInput multiple={false} icon={uploading ? false : 'photo'} variant="secondary" class="cvs-add" onFiles={pickFile} disabled={uploading} testId="cover-upload">
                  {uploading ? '正在处理' : '从相册选'}
                </PhotoInput>
              )}
              {list.map((p, i) => (
                <Thumb
                  key={p.path}
                  path={p.path}
                  label={`第 ${i + 1} 张照片`}
                  selected={current.imagePath === p.path}
                  onPick={() => {
                    if (!canEdit) return;
                    haptic('selection');
                    set({ imagePath: current.imagePath === p.path ? null : p.path });
                  }}
                />
              ))}
            </div>
            <p class="cvs-hint">{photos.length ? '这趟日记和评级里的照片。没有照片时，封面是这趟的路线。' : '这趟还没有照片：可以从相册选一张，也可以先用路线当封面。'}</p>
          </section>

          <section class="cvs-field" aria-labelledby="cvs-color-label">
            <span class="cvs-label" id="cvs-color-label">颜色</span>
            <div class="cvs-swatches" role="radiogroup" aria-labelledby="cvs-color-label" data-testid="cover-colors">
              {choices.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="radio"
                  aria-checked={current.color === c.key ? 'true' : 'false'}
                  aria-label={c.label}
                  class="cvs-swatch accent-scope"
                  style={choiceStyle(c)}
                  data-press="scale"
                  disabled={!canEdit}
                  onClick={() => { haptic('selection'); set({ color: c.key }); }}
                  data-testid={`cover-color-${c.key}`}
                >
                  <span class="cvs-swatch__fill" aria-hidden="true" />
                  {current.color === c.key && <span class="cvs-swatch__check" aria-hidden="true"><Glyph name="check" size={16} stroke={2.6} /></span>}
                </button>
              ))}
            </div>
            <p class="cvs-hint">只点缀在几处：大数字、「今天」「现在」、行程卡片。两趟用不同的颜色，一眼分得出。</p>
          </section>
        </div>
      )}
    </Sheet>
  );
}
