/**
 * Demo content for the seed (the lead's seed calls this): MARGIN(price; cost) =
 * ROUND((price − cost) / price; 2) — e.g. =MARGIN(B2; C2) in a sheet, MARGIN(prop("Price"), prop("Cost")) in a database.
 */
import type { CustomFunction } from '../../../store/types'

export const DEMO_MARGIN_ID = 'fn-margin'

export function demoFunctions(lang: 'en' | 'de' = 'en', now = Date.now()): CustomFunction[] {
  const de = lang === 'de'
  return [
    {
      id: DEMO_MARGIN_ID,
      name: 'MARGIN',
      description: de ? 'Marge: (Preis − Kosten) ÷ Preis, auf 2 Stellen gerundet.' : 'Profit margin: (price − cost) ÷ price, rounded to 2 places.',
      params: [
        {
          name: 'price',
          type: 'number',
          description: de ? 'Verkaufspreis' : 'selling price',
        },
        {
          name: 'cost',
          type: 'number',
          description: de ? 'was es dich kostet' : 'what it costs you',
        },
      ],
      body: {
        k: 'call',
        fn: 'ROUND',
        args: [
          {
            k: 'call',
            fn: '/',
            args: [
              {
                k: 'call',
                fn: '-',
                args: [
                  { k: 'param', name: 'price' },
                  { k: 'param', name: 'cost' },
                ],
              },
              { k: 'param', name: 'price' },
            ],
          },
          { k: 'num', v: 2 },
        ],
      },
      createdAt: now,
      updatedAt: now,
    },
  ]
}
