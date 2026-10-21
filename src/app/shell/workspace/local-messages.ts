import type { Messages } from '@/shared/i18n'
export const localMessages: Messages = {
  en: {
    'shell.locals.new': 'New local workspace…', 'shell.locals.name': 'Workspace name', 'shell.locals.nameError': 'Enter a name of 1–60 characters.',
    'shell.locals.lead': 'Start empty or open a preconfigured workspace package. Your current workspace stays available in the workspace menu.',
    'shell.locals.import': 'Optional: workspace package', 'shell.locals.invalid': 'This is not a One workspace package. Full backups can still be restored through Import.',
    'shell.locals.tooLarge': 'The workspace package exceeds 200 MB.', 'shell.locals.loaded': '{n} pages in this package · automations paused',
    'shell.locals.private': 'Personal settings, keys, MCP connections and worker pairing stay on this device. A package never installs connections or starts automations.',
    'shell.locals.create': 'Create and open', 'shell.locals.creating': 'Saving…',
    'shell.locals.export': 'Export workspace package', 'shell.locals.exportLead': 'Reusable pages, databases, attachments, agents, scripts, appearance and workspace rules. No device settings, keys, connections, approvals or Private pages. Automations arrive paused; webhook destinations are removed.',
    'shell.locals.exporting': 'Preparing package…', 'shell.locals.exportFailed': 'Could not prepare workspace package: {error}',
    'shell.locals.manage': 'Separate workspaces', 'shell.locals.team': 'To work together live, create a team workspace in the workspace menu and copy this local workspace into it. Team roles and invitations stay in place.',
    'shell.locals.switchFailed': 'Could not save before switching. Your current workspace stays open.',
  },
  de: {
    'shell.locals.new': 'Neuer lokaler Workspace…', 'shell.locals.name': 'Workspace-Name', 'shell.locals.nameError': 'Gib einen Namen mit 1–60 Zeichen ein.',
    'shell.locals.lead': 'Leer starten oder ein vorkonfiguriertes Workspace-Paket öffnen. Dein bisheriger Workspace bleibt im Workspace-Menü erreichbar.',
    'shell.locals.import': 'Optional: Workspace-Paket', 'shell.locals.invalid': 'Das ist kein One-Workspace-Paket. Komplett-Backups lassen sich weiterhin über Importieren wiederherstellen.',
    'shell.locals.tooLarge': 'Das Workspace-Paket überschreitet 200 MB.', 'shell.locals.loaded': '{n} Seiten im Paket · Automationen pausiert',
    'shell.locals.private': 'Persönliche Einstellungen, Schlüssel, MCP-Verbindungen und Worker-Kopplung bleiben auf diesem Gerät. Ein Paket installiert keine Verbindungen und startet keine Automationen.',
    'shell.locals.create': 'Anlegen und öffnen', 'shell.locals.creating': 'Speichert…',
    'shell.locals.export': 'Workspace-Paket exportieren', 'shell.locals.exportLead': 'Wiederverwendbare Seiten, Datenbanken, Anhänge, Agenten, Skripte, Aussehen und Workspace-Regeln. Ohne Geräteeinstellungen, Schlüssel, Verbindungen, Freigaben und private Team-Seiten. Automationen kommen pausiert an; Webhook-Ziele werden entfernt.',
    'shell.locals.exporting': 'Paket wird erstellt…', 'shell.locals.exportFailed': 'Workspace-Paket konnte nicht erstellt werden: {error}',
    'shell.locals.manage': 'Getrennte Workspaces', 'shell.locals.team': 'Für gemeinsame Live-Arbeit: Im Workspace-Menü einen Team-Workspace anlegen und diesen lokalen Workspace hineinkopieren. Team-Rollen und Einladungen gelten weiter.',
    'shell.locals.switchFailed': 'Speichern vor dem Wechsel nicht möglich. Dein aktueller Workspace bleibt offen.',
  },
}
