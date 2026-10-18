// 日期格式化：全站唯一实现，避免各页面各写一份导致格式不一致。

const pad = (n: number): string => String(n).padStart(2, '0')

/** `YYYY-MM-DD`，用于「发布日期」「评价时间」这类只需精确到天的场景 */
export const formatDate = (iso: string): string => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * `YYYY-MM-DD HH:mm`，用于订单流转时间线这类需要精确到分钟的场景。
 * 字段可能为 null（订单还没走到该状态），此时返回空串，交给调用方决定占位文案。
 */
export const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
