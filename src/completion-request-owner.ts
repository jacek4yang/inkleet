export type CompletionTicket = {
  readonly sessionId: number;
  readonly sequence: number;
  settled: boolean;
  cancelled: boolean;
};
/** Identity-scoped ownership; an old abort/finally can never affect its successor. */
export class CompletionRequestOwner {
  private active: CompletionTicket | null = null;
  private send: (sessionId: number, sequence: number) => Promise<unknown>;
  constructor(send: (sessionId: number, sequence: number) => Promise<unknown>) { this.send = send; }
  begin(sessionId: number, sequence: number): CompletionTicket {
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0 || !Number.isSafeInteger(sequence) || sequence <= 0)
      throw Error("补全请求身份无效");
    this.cancelActive();
    const ticket = {sessionId, sequence, settled: false, cancelled: false};
    this.active = ticket;
    return ticket;
  }
  cancel(ticket: CompletionTicket | null) {
    if (!ticket || ticket.settled || ticket.cancelled) return;
    ticket.cancelled = true;
    if (this.active === ticket) this.active = null;
    // No automatic retry and no user-facing error for obsolete work. Server-side
    // deadlines remain a fallback when the IPC connection itself has failed.
    try { void this.send(ticket.sessionId, ticket.sequence).catch(() => {}); } catch {}
  }
  cancelActive() { this.cancel(this.active); }
  finish(ticket: CompletionTicket) {
    ticket.settled = true;
    if (this.active === ticket) this.active = null;
  }
}
