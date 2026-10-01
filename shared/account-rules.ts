import { z } from 'zod'

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, '用户名需为 1–32 位字母、数字、下划线或连字符')
export const passwordSchema = z.string().min(10, '密码至少需要 10 个字符').max(128)
export const accountSchema = z.object({
  id: z.string().uuid(),
  username: usernameSchema,
  role: z.enum(['admin', 'user']),
  enabled: z.boolean(),
  created_at: z.string(),
})
export type Account = z.infer<typeof accountSchema>

// Internal Auth identifier only. Users never enter an email and no mail is sent.
export const accountEmail = (username: string) =>
  `${usernameSchema.parse(username)}@users.ouonnki.invalid`

export const adminActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), username: usernameSchema, password: passwordSchema }),
  z.object({ action: z.literal('set-enabled'), id: z.string().uuid(), enabled: z.boolean() }),
  z.object({
    action: z.literal('reset-password'),
    id: z.string().uuid(),
    password: passwordSchema,
  }),
])
