/**
 * 求职信息 / 面经库共用的筛选下拉框。options: [{ value, count }]，
 * formatLabel 把 value 翻成显示文字（分类 key → 中文名）。
 */
export default function FilterSelect({ label, value, onChange, options, allLabel, formatLabel = v => v }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="ml-1 text-[12px] font-bold text-brand-muted">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-[42px] min-w-[140px] rounded-full border border-brand-line bg-brand-card px-4 text-[13px] font-semibold text-brand-ink focus:border-brand-ink focus:outline-none"
      >
        <option value="">{allLabel}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{formatLabel(o.value)}（{o.count}）</option>
        ))}
      </select>
    </label>
  )
}
