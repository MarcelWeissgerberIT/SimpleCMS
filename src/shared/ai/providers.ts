/**
 * The AI providers One talks to — the ONLY source of their names, companies, hosts, account pages and the sentences
 * that say where data goes (design § 10.7). Plates, the setup assistant, receipts, the landing and the help articles
 * read them from here (ai-names.spec compares the help's sentences with these). Registry order = display order.
 * OpenAI is listed but not shipped until slice 4 (its plate reads "comes soon"). No OpenRouter model or maker is named
 * here — those come from the person's catalogue; the Jev Router's id lives in jev.ts.
 */
import type { ProviderId } from './types.ts'

export interface Bilingual {
  en: string
  de: string
}

export interface ProviderInfo {
  id: ProviderId
  /** the product people know ("Claude") */
  name: string
  /** the company that receives a request routed here ("Anthropic") */
  company: string
  /** the code plate (the provider is told by letters, never by colour) */
  code: 'CL' | 'OA' | 'OR' | 'LO'
  /** the plate's subtitle */
  sub: Bilingual
  /** the API host requests go to */
  host: string
  /** the provider's console (keys, limits, usage) */
  consoleUrl: string
  /** where a key is made */
  keyUrl: string
  /** where the spending limit is set (OpenRouter: per key — store/secrets.ts keyLimitUrl() for one key) */
  limitUrl: string
  /** how a key starts (a placeholder and a soft note — refused only when it is ANOTHER provider's: keyOfOther) */
  keyPrefix: string
  /** requests can go here in this build */
  shipped: boolean
  /** where data goes, in one paragraph (plates, the assistant, the privacy article) */
  privacy: Bilingual
  /** the hard spending limit — the provider's, never One's */
  hardLimit: Bilingual
}

export interface OpenRouterInfo extends ProviderInfo {
  /** the Jev Router's privacy sentence (D-S2-25): the picker, step 04 and the privacy article quote it */
  routerPrivacy: Bilingual
  /** Jev as Vorprüfer (slice SJ): what TypeSafe receives — the only source; setup step 04 and the help quote it */
  jevPrivacy: Bilingual
  /** account pages One links to (verify with a real key — UX § 15.6) */
  creditsUrl: string
  privacyUrl: string
  pluginsUrl: string
}

const ANTHROPIC: ProviderInfo = {
  id: 'anthropic',
  name: 'Claude',
  company: 'Anthropic',
  code: 'CL',
  sub: { en: 'ANTHROPIC', de: 'ANTHROPIC' },
  host: 'api.anthropic.com',
  consoleUrl: 'https://console.anthropic.com',
  keyUrl: 'https://console.anthropic.com/settings/keys',
  limitUrl: 'https://console.anthropic.com/settings/limits',
  keyPrefix: 'sk-ant-',
  shipped: true,
  privacy: {
    en: 'Requests go from this browser straight to Anthropic (api.anthropic.com), with your key. Anthropic does not train on API data. With MCP servers, Anthropic connects to them while Claude answers — their tokens go to Anthropic.',
    de: 'Anfragen gehen aus diesem Browser direkt an Anthropic (api.anthropic.com), mit deinem Schlüssel. Anthropic trainiert nicht mit API-Daten. Mit MCP-Servern verbindet sich Anthropic, während Claude antwortet — ihre Tokens gehen an Anthropic.',
  },
  hardLimit: { en: 'Spend limit in the Claude Console', de: 'Ausgabenlimit in der Claude Console' },
}

const OPENAI: ProviderInfo = {
  id: 'openai',
  name: 'OpenAI',
  company: 'OpenAI',
  code: 'OA',
  sub: { en: 'GPT', de: 'GPT' },
  host: 'api.openai.com',
  consoleUrl: 'https://platform.openai.com',
  keyUrl: 'https://platform.openai.com/api-keys',
  limitUrl: 'https://platform.openai.com/settings/organization/limits',
  keyPrefix: 'sk-proj-',
  shipped: false,
  privacy: {
    en: 'Requests go from this browser straight to OpenAI (api.openai.com), with your key. One asks OpenAI not to store them; OpenAI keeps abuse logs for up to 30 days.',
    de: 'Anfragen gehen aus diesem Browser direkt an OpenAI (api.openai.com), mit deinem Schlüssel. One bittet OpenAI, sie nicht zu speichern; OpenAI hält Prüf-Logs bis zu 30 Tage.',
  },
  hardLimit: { en: 'Project limit in the OpenAI dashboard', de: 'Projektlimit im OpenAI-Dashboard' },
}

const OPENROUTER: OpenRouterInfo = {
  id: 'openrouter',
  name: 'OpenRouter',
  company: 'OpenRouter',
  code: 'OR',
  sub: { en: 'MANY MAKERS', de: 'VIELE HERSTELLER' },
  host: 'openrouter.ai',
  consoleUrl: 'https://openrouter.ai',
  keyUrl: 'https://openrouter.ai/settings/keys',
  limitUrl: 'https://openrouter.ai/settings/keys',
  keyPrefix: 'sk-or-v1-',
  shipped: true,
  privacy: {
    en: 'Requests go from this browser to OpenRouter (openrouter.ai), which hands them to the operator of the model you picked. One names the operators you allow, switches OpenRouter’s fallbacks and account plugins off and, unless you switch it off, asks for operators that collect no data. OpenRouter keeps request metadata; your OpenRouter account settings apply on top. No MCP servers.',
    de: 'Anfragen gehen aus diesem Browser an OpenRouter (openrouter.ai), das sie an den Betreiber des gewählten Modells weitergibt. One legt die Betreiber fest, die du erlaubst, schaltet Ausweichmodelle und Konto-Plugins von OpenRouter ab und verlangt, solange du es nicht abschaltest, Betreiber ohne Datensammlung. OpenRouter speichert Metadaten der Anfragen; deine Kontoeinstellungen bei OpenRouter gelten zusätzlich. Keine MCP-Server.',
  },
  hardLimit: { en: 'Key limit at OpenRouter (shown live)', de: 'Schlüssel-Limit bei OpenRouter (live angezeigt)' },
  routerPrivacy: {
    en: 'With the Jev Router, OpenRouter hands your request to Jev (TypeSafe), which picks one of the models in your list; that model’s operator answers. Both receive the request.',
    de: 'Mit dem Jev Router gibt OpenRouter deine Anfrage an Jev (TypeSafe), das eines der Modelle deiner Liste wählt; dessen Betreiber antwortet. Beide erhalten die Anfrage.',
  },
  jevPrivacy: {
    en: 'As a pre-checker, Jev (TypeSafe) receives through OpenRouter the proposals of your agents with their instructions and the row they change — and, when you switch it on, answers with their sources.',
    de: 'Als Vorprüfer erhält Jev (TypeSafe) über OpenRouter die Vorschläge deiner Agenten mit ihrer Anweisung und der Zeile, die sie ändern — und, wenn du es einschaltest, Antworten mit ihren Quellen.',
  },
  creditsUrl: 'https://openrouter.ai/settings/credits',
  privacyUrl: 'https://openrouter.ai/settings/privacy',
  pluginsUrl: 'https://openrouter.ai/settings/plugins',
}

/**
 * A model server on this computer (OpenAI-compatible: Ollama, LM Studio, llama.cpp …) — no company, no account, no key
 * (an optional placeholder only). Its address is the person's own (settings.ai.local — local.ts accepts loopback only);
 * `host` is the default. It is not one of the cloud providers below: no setup step, no plate in their row, no hard limit.
 */
const LOCAL: ProviderInfo = {
  id: 'local',
  name: 'Local',
  company: 'this computer',
  code: 'LO',
  sub: { en: 'OPENAI-COMPATIBLE', de: 'OPENAI-KOMPATIBEL' },
  host: '127.0.0.1',
  consoleUrl: '',
  keyUrl: '',
  limitUrl: '',
  keyPrefix: '',
  shipped: true,
  privacy: {
    en: 'Requests go from this browser to the program at <address> on this computer; nothing goes to One or a provider. One does not see what that program does with them.',
    de: 'Anfragen gehen von diesem Browser an das Programm unter <Adresse> auf diesem Rechner; nichts geht an One oder einen Anbieter. Was das Programm damit macht, sieht One nicht.',
  },
  hardLimit: { en: 'None — it runs on this computer', de: 'Keins — es läuft auf diesem Rechner' },
}

/** Registry order (Claude · OpenAI · OpenRouter) — every list of providers shows them in this order. The local model
 *  server is not in it (it is no provider one sets up with a key — Settings › AI has its own plate). */
export const PROVIDER_ORDER: readonly ProviderId[] = ['anthropic', 'openai', 'openrouter']

export const PROVIDERS: { readonly anthropic: ProviderInfo; readonly openai: ProviderInfo; readonly openrouter: OpenRouterInfo; readonly local: ProviderInfo } = {
  anthropic: ANTHROPIC,
  openai: OPENAI,
  openrouter: OPENROUTER,
  local: LOCAL,
}

/** A provider's entry (an unknown id reads as Claude's — the default path). */
export const providerInfo = (p: ProviderId | string | null | undefined): ProviderInfo => (p === 'openai' ? OPENAI : p === 'openrouter' ? OPENROUTER : p === 'local' ? LOCAL : ANTHROPIC)

/** The local plate's privacy sentence with the address it sends to. */
export const localPrivacy = (lang: 'en' | 'de', address: string): string => LOCAL.privacy[lang].replace(lang === 'de' ? '<Adresse>' : '<address>', address)

/**
 * The provider a pasted key belongs to when it is ANOTHER one than `p` (its known prefix) — a key in the wrong tab is
 * never sent to `p`'s check (it would reach a third party). null: `p`'s own, or an unknown format (a soft note only).
 */
export function keyOfOther(p: ProviderId, key: string): ProviderId | null {
  const k = key.trim()
  return PROVIDER_ORDER.find((q) => q !== p && !!providerInfo(q).keyPrefix && k.startsWith(providerInfo(q).keyPrefix)) ?? null
}

/** The providers requests can go to in this build. */
export const shippedProviders = (): ProviderId[] => PROVIDER_ORDER.filter((p) => providerInfo(p).shipped)
