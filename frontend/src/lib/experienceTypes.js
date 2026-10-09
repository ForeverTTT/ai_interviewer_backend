import { BriefcaseBusiness, GraduationCap, School, Sprout } from 'lucide-react'

/** The kinds of interview a shared experience can describe (form, filters, badges). */
export const EXPERIENCE_TYPES = [
  { value: 'internship', labelKey: 'exp.typeInternship', icon: Sprout },
  { value: 'campus', labelKey: 'exp.typeCampus', icon: GraduationCap },
  { value: 'experienced', labelKey: 'exp.typeExperienced', icon: BriefcaseBusiness },
]

// Posts from before these types: 'work' is migrated to 'internship' in the
// database, but is mapped here too; 'school' (university admission) has no
// new equivalent and keeps its own label. Neither can be chosen for new posts.
const LEGACY_TYPES = {
  work: EXPERIENCE_TYPES[0],
  school: { value: 'school', labelKey: 'exp.filterSchool', icon: School },
}

export function experienceType(value) {
  return EXPERIENCE_TYPES.find((type) => type.value === value) || LEGACY_TYPES[value] || null
}
