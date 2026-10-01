import { describe, expect, it } from 'vitest'
import { validPayload } from './data'

describe('cloud payload compatibility', () => {
  it('accepts nullable legacy favorite fields', () => {
    expect(
      validPayload({
        kind: 'favorite',
        item_key: 'cms_x',
        modified_at: 1,
        mutation_id: 'a',
        deleted: false,
        value: {
          id: 'cms_x',
          addedAt: 1,
          updatedAt: 1,
          sourceType: 'cms',
          watchStatus: 'watching',
          notes: null,
          rating: null,
          tags: [],
          media: { vodId: 'x', vodName: 'X', sourceCode: 's', sourceName: 'S', vodPic: null },
        },
      }),
    ).toBe(true)
  })
})
