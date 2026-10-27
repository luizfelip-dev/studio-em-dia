import type { StudioBackup } from "./studio-api";
type AppointmentStatus = StudioBackup["appointments"][number]["status"];
type PaymentKind = StudioBackup["payments"][number]["kind"];
const APPOINTMENT_STATUS = { scheduled: true, confirmed: true, completed: true, cancelled: true };
const PAYMENT_KIND = { deposit: true, partial: true, final: true, full: true };
const BACKUP_MARKER = "STUDIO_EM_DIA_BACKUP";
const BACKUP_VERSION = 1;
const BACKUP_SYSTEM_SHEET = "_DadosSistema";

function backupObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Dados inválidos em ${label}.`);
  return value as Record<string, unknown>;
}

function backupString(value: unknown, label: string, maxLength: number, allowEmpty = false) {
  if (typeof value !== "string") throw new Error(`Campo inválido em ${label}.`);
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > maxLength) throw new Error(`Campo inválido em ${label}.`);
  return text;
}

function backupNumber(value: unknown, label: string, { integer = false, min = 0 }: { integer?: boolean; min?: number } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || (integer && !Number.isSafeInteger(value))) throw new Error(`Número inválido em ${label}.`);
  if (integer && value > 2_147_483_647) throw new Error(`Valor acima do limite em ${label}.`);
  return value;
}

function backupId(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`Identificador inválido em ${label}.`);
  return value;
}

function backupDate(value: unknown, label: string) {
  const date = backupString(value, label, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error(`Data inválida em ${label}.`);
  return date;
}

function backupTime(value: unknown, label: string) {
  const time = backupString(value, label, 5, true);
  if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Horário inválido em ${label}.`);
  return time;
}

function assertUniqueSourceIds(records: Array<{ sourceId: number }>, label: string) {
  if (new Set(records.map((item) => item.sourceId)).size !== records.length) throw new Error(`O backup possui ${label} repetidos.`);
}

function validateBackupRecord(type: string, value: unknown) {
  const item = backupObject(value, type);
  if (type === "client") {
    const phone = backupString(item.phone, "telefone", 30, true);
    const createdAt = backupString(item.createdAt, "data de cadastro", 40);
    if (phone && phone.length < 8) throw new Error("Telefone inválido no backup.");
    if (Number.isNaN(new Date(createdAt).getTime())) throw new Error("Data de cadastro inválida no backup.");
    return {
      sourceId: backupId(item.sourceId, "cliente"),
      name: backupString(item.name, "cliente", 120),
      phone,
      notes: backupString(item.notes, "observações", 1000, true),
      createdAt,
    };
  }
  if (type === "product") {
    const unit = backupString(item.unit, "unidade", 3);
    if (!["ml", "g", "un."].includes(unit)) throw new Error("Unidade de produto inválida no backup.");
    return {
      sourceId: backupId(item.sourceId, "produto"),
      name: backupString(item.name, "produto", 120),
      purchasePriceCents: backupNumber(item.purchasePriceCents, "preço do produto", { integer: true, min: 1 }),
      totalAmount: backupNumber(item.totalAmount, "quantidade do produto", { min: Number.EPSILON }),
      unit,
      usePerService: backupNumber(item.usePerService, "uso do produto", { min: Number.EPSILON }),
    };
  }
  if (type === "appointment") {
    const status = backupString(item.status, "status", 20) as AppointmentStatus;
    if (!Object.hasOwn(APPOINTMENT_STATUS, status)) throw new Error("Status de atendimento inválido no backup.");
    const clientId = item.clientId === null ? null : backupId(item.clientId, "cliente do atendimento");
    const rawProductIds = item.productIds ?? [];
    if (!Array.isArray(rawProductIds) || rawProductIds.length > 500) throw new Error("Lista de produtos inválida no backup.");
    const productIds = rawProductIds.map((id) => backupId(id, "produto do atendimento"));
    if (new Set(productIds).size !== productIds.length) throw new Error("O backup possui produtos repetidos em um atendimento.");
    return {
      sourceId: backupId(item.sourceId, "atendimento"), clientId,
      clientName: backupString(item.clientName, "cliente do atendimento", 120),
      service: backupString(item.service, "serviço", 240),
      serviceDate: backupDate(item.serviceDate, "atendimento"),
      serviceTime: backupTime(item.serviceTime, "atendimento"), status,
      amountCents: backupNumber(item.amountCents, "valor do atendimento", { integer: true, min: 1 }),
      productIds,
      productCostCents: backupNumber(item.productCostCents, "custo de produtos", { integer: true }),
      extraCostCents: backupNumber(item.extraCostCents, "custo extra", { integer: true }),
      paymentFeeCents: backupNumber(item.paymentFeeCents, "taxa de pagamento", { integer: true }),
    };
  }
  if (type === "payment") {
    const kind = backupString(item.kind, "tipo de pagamento", 20) as PaymentKind;
    if (!Object.hasOwn(PAYMENT_KIND, kind)) throw new Error("Tipo de pagamento inválido no backup.");
    return {
      sourceId: backupId(item.sourceId, "pagamento"),
      appointmentId: backupId(item.appointmentId, "atendimento do pagamento"),
      amountCents: backupNumber(item.amountCents, "valor do pagamento", { integer: true, min: 1 }),
      kind, paidAt: backupDate(item.paidAt, "pagamento"),
      note: backupString(item.note, "observação do pagamento", 300, true),
    };
  }
  if (type === "expense") return {
    sourceId: backupId(item.sourceId, "gasto"),
    description: backupString(item.description, "descrição do gasto", 160),
    category: backupString(item.category, "categoria do gasto", 80),
    expenseDate: backupDate(item.expenseDate, "gasto"),
    amountCents: backupNumber(item.amountCents, "valor do gasto", { integer: true, min: 1 }),
  };
  if (type === "settings") return {
    monthlyGoalCents: backupNumber(item.monthlyGoalCents, "meta mensal", { integer: true, min: 1 }),
    reservePercent: backupNumber(item.reservePercent, "percentual de reserva"),
  };
  throw new Error("O arquivo contém um tipo de registro desconhecido.");
}

export async function readBackupFile(file: File): Promise<StudioBackup> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Escolha um arquivo Excel .xlsx exportado pelo Studio em Dia.");
  if (file.size > 20 * 1024 * 1024) throw new Error("O arquivo é grande demais para ser um backup válido.");
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.getWorksheet(BACKUP_SYSTEM_SHEET);
  if (!sheet || sheet.getCell("A1").text !== BACKUP_MARKER || Number(sheet.getCell("B1").value) !== BACKUP_VERSION) {
    throw new Error("Este Excel não possui os dados técnicos de restauração. Exporte um novo backup pelo Studio em Dia e tente novamente.");
  }
  const backup: StudioBackup = {
    format: "studio-em-dia", version: 1, exportedAt: sheet.getCell("C1").text,
    clients: [], products: [], appointments: [], payments: [], expenses: [],
    settings: { monthlyGoalCents: 0, reservePercent: 0 },
  };
  let settingsFound = false;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return;
    const type = row.getCell(1).text;
    const json = row.getCell(2).text;
    if (!type && !json) return;
    if (!type || !json) throw new Error("O backup contém uma linha incompleta.");
    let decoded: unknown;
    try { decoded = JSON.parse(json); } catch { throw new Error("O backup contém uma linha danificada."); }
    const record = validateBackupRecord(type, decoded);
    if (type === "client") backup.clients.push(record as StudioBackup["clients"][number]);
    else if (type === "product") backup.products.push(record as StudioBackup["products"][number]);
    else if (type === "appointment") backup.appointments.push(record as StudioBackup["appointments"][number]);
    else if (type === "payment") backup.payments.push(record as StudioBackup["payments"][number]);
    else if (type === "expense") backup.expenses.push(record as StudioBackup["expenses"][number]);
    else if (type === "settings") { if (settingsFound) throw new Error("O backup possui configurações repetidas."); backup.settings = record as StudioBackup["settings"]; settingsFound = true; }
  });
  if (!settingsFound) throw new Error("O backup não contém as configurações necessárias.");
  const totalRecords = backup.clients.length + backup.products.length + backup.appointments.length + backup.payments.length + backup.expenses.length;
  if (totalRecords > 20_000) throw new Error("O backup ultrapassa o limite seguro de registros.");
  assertUniqueSourceIds(backup.clients, "clientes");
  assertUniqueSourceIds(backup.products, "produtos");
  assertUniqueSourceIds(backup.appointments, "atendimentos");
  assertUniqueSourceIds(backup.payments, "pagamentos");
  assertUniqueSourceIds(backup.expenses, "gastos");
  const clientIds = new Set(backup.clients.map((item) => item.sourceId));
  const productIds = new Set(backup.products.map((item) => item.sourceId));
  const appointmentIds = new Set(backup.appointments.map((item) => item.sourceId));
  if (backup.appointments.some((item) => item.clientId !== null && !clientIds.has(item.clientId))) throw new Error("O backup contém um atendimento sem cliente correspondente.");
  if (backup.appointments.some((item) => item.productIds.some((id) => !productIds.has(id)))) throw new Error("O backup contém um atendimento com produto desconhecido.");
  if (backup.payments.some((item) => !appointmentIds.has(item.appointmentId))) throw new Error("O backup contém um pagamento sem atendimento correspondente.");
  const paidByAppointment = new Map<number, number>();
  backup.payments.forEach((payment) => paidByAppointment.set(payment.appointmentId, (paidByAppointment.get(payment.appointmentId) ?? 0) + payment.amountCents));
  if (backup.appointments.some((appointment) => (paidByAppointment.get(appointment.sourceId) ?? 0) > appointment.amountCents)) throw new Error("O backup contém pagamentos acima do valor de um atendimento.");
  if (backup.settings.reservePercent > 100) throw new Error("O percentual de reserva do backup é inválido.");
  return backup;
}

