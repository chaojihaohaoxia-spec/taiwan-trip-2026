// =====================================================================
// pages/contacts/ContactSheet.jsx：添加 / 编辑联系人（页面里的底部面板，id `contact-edit`，联系人页无条件渲染）。
//
//   openContactSheet('new' | 'new-hotel' | contact.id, { trigger })   参数写法见 form.js 的 parseArg
//
//   名字（新建时自动聚焦）+ 身份             一块往下凹的输入区
//   类别                                      芯片（紧急 / 酒店 / 交通 / 餐厅 …）
//   联系方式                                  电话、WhatsApp、Zalo、邮箱、微信、LINE 一栏一行；WhatsApp / Zalo 有「同电话」一键填
//   备注                                      多行
//   编辑时：删除（数据层弹「已删除 · 撤销」，这里不再确认）
// 提交：SubmitButton 受控（文字 → 转圈 → 对勾）：先检查（不通过：那一栏摇一下、下面说原因、不转圈），通过才 insert / update →
//       await r.saved（写进本机队列就算成功，离线也行）→ 对勾 → 面板收回（force，不再问）→ 新建的那一个在列表里展开、闪一下。
// 只读成员：输入全部禁用、没有提交和删除，顶上说明。改了一半关面板先问「放弃未保存的内容？」。
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Sheet, openOverlay, closeOverlay } from '../../overlay/index.js';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { Chip } from '../../ui/Chip.jsx';
import { route, setQuery } from '../../router/index.js';
import { animateSpring } from '../../motion/animate.js';
import { num } from '../../motion/physics.js';
import { SHAKE_SPRING, SHAKE_VELOCITY, SHAKE_PRECISION } from '../../ui/shake.js';
import { Glyph } from '../../kit/Glyph.jsx';
import { kindGlyph } from '../../kit/kinds.js';
import { haptic } from '../../lib/native.js';
import {
  CONTACT_SHEET, parseArg, CATEGORY_OPTIONS, FIELDS, initialForm, isDirty, validateForm, formToValues, changedValues, nextSort,
} from './form.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** 对勾描完再收面板 */
const SUCCESS_HOLD = 620;
const MIN_LOADING = 380;

/** 打开面板（新建时在点击回调里同步叫出键盘：iOS 才会弹） */
export function openContactSheet(arg, opts = {}) {
  const isNew = parseArg(arg).mode === 'new';
  return openOverlay(CONTACT_SHEET, { arg: arg || 'new', keyboard: isNew, ...opts });
}

/** 那一栏左右摇一下（参数同提交按钮的摇头，ui/shake.js） */
function shake(el) {
  if (!el) return;
  animateSpring(el, {
    channel: 'ctf-shake',
    from: { x: 0 },
    to: { x: 0 },
    velocity: { x: SHAKE_VELOCITY },
    spring: SHAKE_SPRING,
    precision: { x: SHAKE_PRECISION },
    commit: 'clear',
    reduced: 'instant',
    render: ({ x }) => ({ transform: `translateX(${num(x)}px)` }),
  });
}

/**
 * @param {{ store: object, canEdit: boolean }} props
 */
export function ContactSheet({ store, canEdit }) {
  // 面板的参数（收回动画期间网址里已经没有了：用最后一次的，内容不会一下子变空）
  const hit = (route.value?.sheets || []).find((s) => s.id === CONTACT_SHEET);
  const lastArg = useRef('new');
  if (hit) lastArg.current = hit.arg || 'new';
  const arg = lastArg.current;
  const parsed = parseArg(arg);
  const contacts = store?.tables.contacts.value;
  const row = parsed.mode === 'edit' ? contacts?.get(parsed.id) || null : null;
  const missing = parsed.mode === 'edit' && !row;
  // 打开面板那一刻的那一行：初始值和“改了什么”都按它算——面板开着时另一台手机改了这个联系人，
  // 这边保存不会把对方改的字段改回去（代码评审 P1-1）；换了联系人（id 变了）才重新取
  const rowAtOpen = useRef(null);
  const isOpen = Boolean(hit);
  const initial = useMemo(() => {
    rowAtOpen.current = row;
    return initialForm(row, { category: parsed.category });
  }, [arg, row?.id, isOpen]);

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [btn, setBtn] = useState('idle');
  const [fail, setFail] = useState('');
  const refs = useRef({});
  // 换了一个联系人、或者重新打开（同一个联系人第二次打开也从头来：按钮不会停在上次的对勾上）
  const open = Boolean(hit);
  useEffect(() => {
    if (!open) return;
    setForm(initial);
    setErrors({});
    setBtn('idle');
    setFail('');
  }, [open, arg, row?.id]);

  const readOnly = !canEdit;
  const dirty = !readOnly && isDirty(form, initial);
  const title = parsed.mode === 'edit' ? '编辑联系人' : '添加联系人';

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function submit() {
    if (readOnly || btn === 'loading' || btn === 'success') return;
    const errs = validateForm(form);
    const keys = Object.keys(errs);
    setErrors(errs);
    if (keys.length) {
      haptic('warning');
      const first = refs.current[keys[0]];
      shake(first?.closest('[data-field]') || first);
      first?.focus?.();
      return;
    }
    setBtn('loading');
    setFail('');
    const started = Date.now();
    try {
      const values = formToValues(form);
      let id = row?.id || null;
      if (row) {
        const patch = changedValues(values, rowAtOpen.current || row);
        if (Object.keys(patch).length) {
          const r = store.update('contacts', row.id, patch);
          if (r?.saved) await r.saved;
        }
      } else {
        const r = store.insert('contacts', { ...values, sort: nextSort(contacts ? [...contacts.values()] : []) });
        id = r.row.id;
        await r.saved;
      }
      const left = MIN_LOADING - (Date.now() - started);
      if (left > 0) await wait(left);
      setBtn('success');
      haptic('success');
      await wait(SUCCESS_HOLD);
      await closeOverlay(CONTACT_SHEET, { force: true });
      // 新建的：在列表里展开、滚过去、闪一下（清掉可能把它藏起来的筛选）
      if (!row && id) setQuery({ contact: id, q: null, cat: null });
    } catch (e) {
      setFail(e?.message && /[一-鿿]/.test(e.message) ? e.message : '没有保存上，请重试');
      setBtn('error');
      haptic('warning');
      setTimeout(() => setBtn((s) => (s === 'error' ? 'idle' : s)), 2600);
    }
  }

  function remove() {
    if (!row || readOnly) return;
    haptic('medium');
    // 外壳弹「已删除 · 撤销」（数据层的撤销窗口），这里不再确认
    store.remove('contacts', row.id, { undoMs: 6000 });
    closeOverlay(CONTACT_SHEET, { force: true });
  }

  const footer = readOnly || missing ? null : (
    <div class="ctf-foot">
      {fail && <p class="ctf-fail" role="alert" data-testid="contact-form-fail">{fail}</p>}
      <SubmitButton
        block
        state={btn}
        label={parsed.mode === 'edit' ? '保存' : '添加联系人'}
        loadingLabel="正在保存"
        successLabel={parsed.mode === 'edit' ? '已保存' : '已添加'}
        errorMessage={fail || '没有保存上'}
        onClick={submit}
        data-testid="contact-form-submit"
      />
    </div>
  );

  return (
    <Sheet
      sheetId={CONTACT_SHEET}
      title={title}
      detents={['large']}
      confirmClose={dirty}
      footer={footer}
      testId="sheet-contact"
    >
      {missing ? (
        <p class="ctf-missing" data-testid="contact-form-missing">找不到这个联系人：可能已经被删除了。</p>
      ) : (
        <form
          class="ctf"
          data-readonly={readOnly ? '' : undefined}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
        >
          {readOnly && <p class="ctf-note" data-testid="contact-form-readonly">你是只读成员：可以打电话、发消息、复制，不能改联系人。</p>}

          <div class="ctf-box" data-field="name" data-error={errors.name ? '' : undefined}>
            <input
              ref={(el) => { refs.current.name = el; }}
              class="ctf-name"
              type="text"
              value={form.name}
              placeholder="名字（酒店前台、接机司机…）"
              aria-label="名字"
              aria-invalid={errors.name ? 'true' : undefined}
              autoComplete="off"
              enterKeyHint="next"
              disabled={readOnly}
              autoFocus={parsed.mode === 'new' && !readOnly}
              data-testid="contact-form-name"
              onInput={(e) => set('name')(e.currentTarget.value)}
            />
            <input
              class="ctf-role"
              type="text"
              value={form.role}
              placeholder="身份（前台、老板娘、司机…，可不填）"
              aria-label="身份"
              autoComplete="off"
              enterKeyHint="next"
              disabled={readOnly}
              data-testid="contact-form-role"
              onInput={(e) => set('role')(e.currentTarget.value)}
            />
          </div>
          {errors.name && <p class="ctf-err" data-testid="contact-form-error-name">{errors.name}</p>}

          <fieldset class="ctf-group" disabled={readOnly}>
            <legend class="ctf-label">类别</legend>
            <div class="ctf-cats" role="group" aria-label="类别" data-testid="contact-form-cats">
              {CATEGORY_OPTIONS.map((o) => (
                <Chip
                  key={o.value}
                  size="sm"
                  selected={form.category === o.value}
                  onToggle={() => {
                    haptic('selection');
                    set('category')(o.value);
                  }}
                  icon={(p) => <Glyph name={kindGlyph('contact', o.value)} size={p.size} />}
                  disabled={readOnly}
                  data-value={o.value}
                >
                  {o.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <div class="ctf-group">
            <p class="ctf-label" id="ctf-ways">联系方式</p>
            <div class="ctf-box ctf-box--rows" role="group" aria-labelledby="ctf-ways">
              {FIELDS.map((f) => (
                <div key={f.key} class="ctf-row" data-field={f.key} data-error={errors[f.key] ? '' : undefined}>
                  <label class="ctf-row__label" for={`ctf-${f.key}`}>{f.label}</label>
                  <input
                    id={`ctf-${f.key}`}
                    ref={(el) => { refs.current[f.key] = el; }}
                    class={`ctf-row__input${f.type === 'tel' ? ' ctf-row__input--num' : ''}`}
                    type={f.type}
                    inputMode={f.inputMode}
                    value={form[f.key]}
                    placeholder={f.placeholder}
                    autoComplete={f.autoComplete}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellcheck={false}
                    enterKeyHint="next"
                    aria-invalid={errors[f.key] ? 'true' : undefined}
                    disabled={readOnly}
                    data-testid={`contact-form-${f.key}`}
                    onInput={(e) => set(f.key)(e.currentTarget.value)}
                  />
                  {f.samePhone && !readOnly && form.phone.trim() && !form[f.key].trim() && (
                    <button
                      type="button"
                      class="ctf-same"
                      data-press="scale"
                      aria-label={`${f.label}用电话号码`}
                      data-testid={`contact-form-same-${f.key}`}
                      onClick={() => {
                        haptic('selection');
                        set(f.key)(form.phone.trim());
                      }}
                    >
                      同电话
                    </button>
                  )}
                  {errors[f.key] && <p class="ctf-row__err" data-testid={`contact-form-error-${f.key}`}>{errors[f.key]}</p>}
                </div>
              ))}
            </div>
          </div>

          <div class="ctf-group">
            <label class="ctf-label" for="ctf-note">备注</label>
            <div class="ctf-box">
              <textarea
                id="ctf-note"
                class="ctf-noteinput"
                rows={3}
                value={form.note}
                placeholder="比如：只会英文，发消息比打电话快；晚上 10 点后不回"
                disabled={readOnly}
                data-testid="contact-form-note"
                onInput={(e) => set('note')(e.currentTarget.value)}
              />
            </div>
          </div>

          {row && !readOnly && (
            <button type="button" class="ctf-delete" data-press="scale" onClick={remove} data-testid="contact-form-delete">
              <Glyph name="trash" size={18} />
              <span>删除这个联系人</span>
            </button>
          )}
        </form>
      )}
    </Sheet>
  );
}
