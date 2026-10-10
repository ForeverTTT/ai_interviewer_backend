import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'

/**
 * 求职信息 / 面经库共用的多选筛选下拉框。
 *
 * options: [{ value, count }]；values: 已选的 value 数组，空数组 = 不限。
 * formatLabel 把 value 翻成显示文字（分类 key → 中文名）。
 * 同一个框里多选是「任一满足」，不同框之间是「同时满足」，由调用方实现。
 *
 * 键盘：按钮上 ↓ / Enter / 空格打开；列表里 ↑↓ 移动，Enter / 空格勾选，Esc 关闭。
 */
export default function FilterSelect({ label, values, onChange, options, allLabel, formatLabel = v => v }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const listRef = useRef(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  const toggle = (value) => {
    onChange(values.includes(value) ? values.filter(v => v !== value) : [...values, value])
  }

  const close = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onListKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(i => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (options[active]) toggle(options[active].value)
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault()
      close()
    }
  }

  const summary = values.length === 0
    ? allLabel
    : values.length <= 2
      ? values.map(formatLabel).join('、')
      : t('taxonomy.selectedCount', { n: values.length })

  return (
    <div ref={rootRef} className="relative flex min-w-0 flex-col gap-1.5">
      <span className="ml-1 text-[12px] font-bold text-brand-muted">{label}</span>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className={`flex h-[42px] min-w-[140px] max-w-[220px] items-center justify-between gap-2 rounded-full border bg-brand-card px-4 text-left text-[13px] font-semibold transition-colors focus:outline-none ${
          open ? 'border-brand-ink' : 'border-brand-line hover:border-brand-muted/50'
        } ${values.length ? 'text-brand-ink' : 'text-brand-muted'}`}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-brand-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="brand-float absolute left-0 top-full z-[100] mt-2 w-max min-w-full max-w-[min(320px,calc(100vw-32px))] overflow-hidden rounded-[18px] border border-brand-line">
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
            aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
            tabIndex={-1}
            onKeyDown={onListKey}
            className="custom-scrollbar max-h-[300px] overflow-y-auto p-1.5 focus:outline-none"
          >
            {options.length === 0 && (
              <li className="px-3 py-2.5 text-[12.5px] text-brand-muted">{t('taxonomy.noOptions')}</li>
            )}
            {options.map((o, i) => {
              const selected = values.includes(o.value)
              return (
                <li
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => toggle(o.value)}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] ${
                    i === active ? 'bg-brand-inset' : ''
                  } ${selected ? 'font-bold text-brand-ink' : 'text-brand-ink'}`}
                >
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border ${
                    selected ? 'border-brand-ink bg-brand-ink text-brand-on-ink' : 'border-brand-line bg-brand-card'
                  }`}>
                    {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="flex-1 whitespace-nowrap">{formatLabel(o.value)}</span>
                  <span className="text-[11.5px] tabular-nums text-brand-muted">{o.count}</span>
                </li>
              )
            })}
          </ul>
          {values.length > 0 && (
            <div className="flex justify-end border-t border-brand-line px-3 py-2">
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[12px] font-bold text-brand-muted hover:text-brand-ink"
              >
                {t('taxonomy.clear')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
