/**
 * Evento de abatimento transmitido no kill feed (pós-delay de 30 s).
 * Não é persistido — só trafega em RAM -> WebSocket.
 */
export interface KillFeedEntry {
  attackerName: string | null; // null em suicídios/morte pelo mundo
  attackerTeam: string | null; // "CT" | "TR" | "UNASSIGNED"
  victimName: string;
  victimTeam: string;
  victimIsBot: boolean;
  weapon: string | null;
  isHeadshot: boolean;
}
