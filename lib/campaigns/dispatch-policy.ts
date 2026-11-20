export function canStartCampaign(status: string) {
  return status === "Draft";
}

export function canDispatchRecipient(queueStatus: string, ownsReservation: boolean) {
  return queueStatus === "queued" && ownsReservation;
}
