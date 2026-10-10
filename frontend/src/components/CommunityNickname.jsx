import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, UserRound } from 'lucide-react'
import NicknameField from './NicknameField'
import { useNickname } from '../hooks/useNickname'

/** 个人资料页头部：显示 / 修改社区昵称（面经库里用昵称发布时显示的名字） */
export default function CommunityNickname() {
  const { t } = useTranslation()
  const { nickname, setNickname, loaded } = useNickname()
  const [editing, setEditing] = useState(false)

  if (!loaded) return null

  if (editing) {
    return (
      <div className="max-w-md">
        <NicknameField
          initial={nickname || ''}
          autoFocus
          onSaved={(saved) => {
            setNickname(saved)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-brand-muted">
      <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{t('nickname.profileLabel')}：</span>
      <span className={nickname ? 'font-bold text-brand-ink' : ''}>{nickname || t('nickname.notSet')}</span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 font-bold text-brand-ink underline-offset-4 hover:underline"
      >
        <Pencil className="h-3 w-3" />
        {nickname ? t('nickname.edit') : t('nickname.set')}
      </button>
    </div>
  )
}
