// =====================================================================
// sheets/booking/BookingSheet.jsx：弹层「booking」——预订详情（SPEC §5.6、§9.2）。
//
//   openBookingSheet(booking.id, { trigger })                      看详情（sheets/index.js 的帮手）
//   ?sheet=booking:<预订 id>                                         网址直接打开（刷新、分享、搜索结果）
//   ?sheet=booking:id.<预订 id>~m.edit                               直接进「改」模式（编辑成员才有）
//   ?sheet=booking:id.<预订 id>~t.files                              打开后滚到某一节：files 附件 / contacts 联系人 / todos 待办 / payment 付款
//
// 看：全部 details、付款情况（谁付、付了多少、还要付多少）、附件（确认单 PDF：私有桶签名链接，data 的文件接口）、
//     管理链接、关联联系人（打电话 / WhatsApp https://wa.me/<号码> / Zalo）、关联待办（能直接勾）、行程里的安排、备注（Detail.jsx）。
// 改：状态、付款（谁付、订金多少、付款方式）、订单号、备注（EditForm.jsx）；底部「取消 / 保存」，保存是 SubmitButton（转圈 → 对勾），
//     改了一半关面板先问「放弃未保存的内容？」（Sheet 的 confirmClose）。只读成员没有「修改」，看得到说明。
// 一键：待确认 →「商家确认了」、未付 / 到店付 →「已付清」，不用进编辑；改完 Toast 带「撤销」。
//
// 弹层组件是全站共用、按需加载的（OverlayHost 在网址第一次出现 booking 时才下载这个模块，之后一直挂着），
// 只靠网址参数渲染：刷新、返回、分享链接都能恢复。关的时候网址里已经没有参数了，记住最后一个，退场动画期间内容不变。
// =====================================================================

import './booking.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { route } from '../../router/index.js';
import { Sheet, toast, useOverlay } from '../../overlay/index.js';
import { data } from '../../data/index.js';
import { parseAmount } from '../../lib/money.js';
import { haptic } from '../../lib/native.js';
import { Button } from '../../ui/Button.jsx';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { Skeleton } from '../../ui/Skeleton.jsx';
import { EmptyState } from '../../ui/EmptyState.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { ErrorState } from '../../kit/States.jsx';
import { useSheetTrip } from '../hooks.js';
import { parseSheetArg } from '../args.js';
import { Detail } from './Detail.jsx';
import { EditForm } from './EditForm.jsx';
import { formOf, formDirty, patchFromForm, sheetSubtitle, needsPayer, titleText } from './model.js';

export const SHEET_ID = 'booking';

/** 网址里这个弹层的参数；弹层关掉以后（网址里没有了）记住最后一个，退场动画期间内容不变 */
function useLastArg(id) {
  const layer = route.value?.sheets?.find((s) => s.id === id);
  const last = useRef(null);
  if (layer) last.current = layer.arg ?? null;
  return { arg: last.current, open: Boolean(layer) };
}

export default function BookingSheet() {
  const { arg, open } = useLastArg(SHEET_ID);
  const { id, fields } = parseSheetArg(arg);
  const { store, pending } = useSheetTrip();
  const booking = id ? store?.tables.bookings.value.get(id) || null : null;
  const trip = store?.trip.value || null;
  const canEdit = Boolean(store?.view.canEdit.value);
  const readOnly = Boolean(store && trip && !canEdit);

  // 编辑状态放在这里：底部的「保存」和中间的表单都要用
  const [edit, setEdit] = useState(null); // { id, base, form, errors }
  const [swap, setSwap] = useState(0);
  const editing = Boolean(edit && booking && edit.id === booking.id);
  const dirty = editing ? formDirty(edit.base, edit.form) : false;

  const startEdit = () => {
    if (!booking || !canEdit) return;
    const form = formOf(booking);
    const myId = data.userId.value;
    if (needsPayer(form.payment_status) && !form.paid_by_user_id && myId) form.paid_by_user_id = myId;
    setEdit({ id: booking.id, base: booking, form, errors: {} });
    setSwap((n) => n + 1);
    haptic('selection');
  };
  const stopEdit = () => {
    setEdit(null);
    setSwap((n) => n + 1);
  };

  // 换了一个预订（或关掉了）就退出编辑
  useEffect(() => {
    if (edit && (!open || edit.id !== id)) setEdit(null);
  }, [open, id]);

  // ?sheet=booking:id.<id>~m.edit：直接进「改」模式
  useEffect(() => {
    if (open && fields.mode === 'edit' && booking && canEdit && !edit) startEdit();
  }, [open, arg, booking?.id, canEdit]);

  const onChange = (patch) => setEdit((e) => (e ? { ...e, form: { ...e.form, ...patch }, errors: {} } : e));

  const save = async () => {
    const { patch, errors, changed } = patchFromForm(edit.base, edit.form, { parseAmount });
    if (Object.keys(errors).length) {
      setEdit((e) => (e ? { ...e, errors: { ...errors, _seq: (e.errors?._seq || 0) + 1 } } : e));
      throw new Error(Object.values(errors)[0]);
    }
    if (!changed) return;
    let r;
    try {
      r = store.update('bookings', edit.id, patch, { label: `修改预订「${booking.title}」` });
    } catch (e) {
      toast.error(e?.message || '没有保存成功，请重试');
      throw e;
    }
    const res = await r.saved;
    if (res && res.durable === false) toast.warning('这台手机的存储暂时用不了：改动先放在内存里，别关掉页面，联网后会自动同步');
  };

  const title = booking ? titleText(booking.title) : '预订详情';
  const description = booking ? (editing ? '改状态、付款、订单号和备注' : sheetSubtitle(booking)) : null;

  let footer = null;
  if (booking && canEdit) {
    footer = editing ? (
      <div class="bks-foot" data-testid="booking-edit-foot">
        <Button variant="secondary" onClick={stopEdit} data-testid="booking-cancel-edit">取消</Button>
        <SubmitButton
          label="保存"
          loadingLabel="正在保存"
          errorMessage={Object.values(edit.errors || {}).find((v) => typeof v === 'string') || '没有保存成功，请重试'}
          action={save}
          onSuccess={stopEdit}
          resetAfter={false}
          size="md"
          block
          data-testid="booking-save"
        />
      </div>
    ) : (
      <Button variant="secondary" block leading={<Glyph name="pen" size={18} />} onClick={startEdit} data-testid="booking-edit">
        修改状态、付款和订单号
      </Button>
    );
  }

  return (
    <Sheet
      sheetId={SHEET_ID}
      title={title}
      description={description}
      detents={['content', 'large']}
      confirmClose={dirty}
      footer={footer}
      testId="sheet-booking"
      class="bks-sheet"
      onClosed={() => setEdit(null)}
    >
      {() => (
        <Body
          id={id}
          tab={fields.tab || null}
          booking={booking}
          store={store}
          trip={trip}
          pending={pending}
          readOnly={readOnly}
          edit={editing ? edit : null}
          swap={swap}
          onEdit={startEdit}
          onChange={onChange}
        />
      )}
    </Sheet>
  );
}

function Body({ id, tab, booking, store, trip, pending, readOnly, edit, swap, onEdit, onChange }) {
  const ov = useOverlay();
  if (!booking) {
    if (!store || pending || store.status.value === 'loading' || store.status.value === 'idle') {
      return (
        <div class="bks bks--loading" aria-busy="true" data-testid="booking-loading">
          <span class="visually-hidden" role="status">正在读取预订…</span>
          <Skeleton variant="rect" height={132} radius="xl" />
          <Skeleton variant="text" lines={3} />
          <Skeleton variant="rect" height={52} radius="lg" />
        </div>
      );
    }
    if (store.status.value === 'error') {
      return <ErrorState compact error={store.error.value} onRetry={() => store.refresh?.()} testId="booking-error" />;
    }
    return (
      <div class="bks__missing" data-testid="booking-missing">
        <EmptyState
          compact
          title="找不到这个预订"
          description={id ? '可能刚被删除了，或者链接不完整。' : '链接里没有写是哪一个预订。'}
          action={<Button variant="secondary" onClick={() => ov?.close()}>关闭</Button>}
        />
      </div>
    );
  }
  if (edit) {
    return (
      <div key={`edit-${swap}`} class={swap ? 'bks-swap' : undefined}>
        <EditForm
          booking={booking}
          form={edit.form}
          errors={edit.errors}
          members={store?.view.members.value || []}
          memberName={(uid) => store?.memberName?.(uid)}
          myId={data.userId.value}
          onChange={onChange}
        />
      </div>
    );
  }
  return (
    <div key={`view-${swap}`} class={swap ? 'bks-swap' : undefined}>
      <Detail booking={booking} store={store} trip={trip} readOnly={readOnly} onEdit={onEdit} tab={tab} />
    </div>
  );
}
