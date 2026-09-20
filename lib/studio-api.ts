import { supabase } from "./supabase";

type ProductRow = { id: number; name: string; purchase_price_cents: number; total_amount: number; unit: string; use_per_service: number };
type ClientRow = { id: number; name: string; phone: string | null; notes: string | null; created_at: string };
type AppointmentStatus = "scheduled" | "confirmed" | "completed" | "cancelled";
type AppointmentRow = { id: number; client_id: number | null; client_name: string; service: string; service_date: string; service_time: string | null; status: AppointmentStatus; amount_cents: number; product_ids: number[] | null; product_cost_cents: number; extra_cost_cents: number; payment_fee_cents: number };
type PaymentKind = "deposit" | "partial" | "final" | "full";
type PaymentRow = { id: number; appointment_id: number; amount_cents: number; kind: PaymentKind; paid_at: string; note: string | null };
type ExpenseRow = { id: number; description: string; category: string; expense_date: string; amount_cents: number };
type SettingsRow = { monthly_goal_cents: number; reserve_percent: number };

export type StudioBackup = {
  format: "studio-em-dia";
  version: 1;
  exportedAt: string;
  clients: Array<{ sourceId: number; name: string; phone: string; notes: string; createdAt: string }>;
  products: Array<{ sourceId: number; name: string; purchasePriceCents: number; totalAmount: number; unit: string; usePerService: number }>;
  appointments: Array<{ sourceId: number; clientId: number | null; clientName: string; service: string; serviceDate: string; serviceTime: string; status: AppointmentStatus; amountCents: number; productIds: number[]; productCostCents: number; extraCostCents: number; paymentFeeCents: number }>;
  payments: Array<{ sourceId: number; appointmentId: number; amountCents: number; kind: PaymentKind; paidAt: string; note: string }>;
  expenses: Array<{ sourceId: number; description: string; category: string; expenseDate: string; amountCents: number }>;
  settings: { monthlyGoalCents: number; reservePercent: number };
};

export type StudioImportResult = {
  added: number;
  kept: number;
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message || "Não foi possível acessar os dados.");
}

function costPerUseCents(product: Pick<ProductRow, "purchase_price_cents" | "total_amount" | "use_per_service">) {
  return Math.round((product.purchase_price_cents / Number(product.total_amount)) * Number(product.use_per_service));
}

function productPayload(payload: Record<string, unknown>) {
  const name = String(payload.name ?? "").trim();
  const purchasePriceCents = Number(payload.purchasePriceCents);
  const totalAmount = Number(payload.totalAmount);
  const unit = String(payload.unit ?? "");
  const usePerService = Number(payload.usePerService);
  if (!name) throw new Error("Informe o nome do produto.");
  if (!Number.isInteger(purchasePriceCents) || purchasePriceCents <= 0) throw new Error("Informe um preço válido para o produto.");
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) throw new Error("Informe a quantidade da embalagem.");
  if (!Number.isFinite(usePerService) || usePerService <= 0) throw new Error("Informe o uso médio por atendimento.");
  if (!["ml", "g", "un."].includes(unit)) throw new Error("Escolha uma unidade válida.");
  return { name, purchase_price_cents: purchasePriceCents, total_amount: totalAmount, unit, use_per_service: usePerService };
}

async function productSelection(value: unknown) {
  const productIds = [...new Set(Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item) && item > 0) : [])];
  if (!productIds.length) return { productIds, productCostCents: 0 };
  const result = await supabase.from("products").select("id,purchase_price_cents,total_amount,use_per_service").in("id", productIds);
  fail(result.error);
  if ((result.data ?? []).length !== productIds.length) throw new Error("Um dos produtos selecionados não está mais disponível.");
  return {
    productIds,
    productCostCents: (result.data ?? []).reduce((sum, item) => sum + costPerUseCents(item), 0),
  };
}

function productFromRow(item: ProductRow) {
  return {
    id: item.id,
    name: item.name,
    purchasePriceCents: item.purchase_price_cents,
    totalAmount: Number(item.total_amount),
    unit: item.unit,
    usePerService: Number(item.use_per_service),
    costPerUseCents: costPerUseCents(item),
  };
}

function appointmentFromRow(item: AppointmentRow, payments: PaymentRow[]) {
  const totalCostCents = item.product_cost_cents + item.extra_cost_cents + item.payment_fee_cents;
  const paidCents = payments.reduce((sum, payment) => sum + payment.amount_cents, 0);
  return {
    id: item.id,
    clientId: item.client_id,
    clientName: item.client_name,
    service: item.service,
    serviceDate: item.service_date,
    serviceTime: item.service_time?.slice(0, 5) ?? "",
    status: item.status,
    amountCents: item.amount_cents,
    productIds: item.product_ids ?? [],
    productCostCents: item.product_cost_cents,
    extraCostCents: item.extra_cost_cents,
    paymentFeeCents: item.payment_fee_cents,
    totalCostCents,
    profitCents: item.amount_cents - totalCostCents,
    paidCents,
    pendingCents: Math.max(0, item.amount_cents - paidCents),
    payments: payments.map((payment) => ({ id: payment.id, amountCents: payment.amount_cents, kind: payment.kind, paidAt: payment.paid_at, note: payment.note ?? "" })),
  };
}

function clientFromRow(item: ClientRow) {
  return { id: item.id, name: item.name, phone: item.phone ?? "", notes: item.notes ?? "", createdAt: item.created_at };
}

function expenseFromRow(item: ExpenseRow) {
  return { id: item.id, description: item.description, category: item.category, expenseDate: item.expense_date, amountCents: item.amount_cents };
}

export async function getStudioData() {
  const [clientsResult, productsResult, appointmentsResult, paymentsResult, expensesResult, settingsResult] = await Promise.all([
    supabase.from("clients").select("id,name,phone,notes,created_at").order("name", { ascending: true }),
    supabase.from("products").select("id,name,purchase_price_cents,total_amount,unit,use_per_service").order("created_at", { ascending: false }),
    supabase.from("appointments").select("id,client_id,client_name,service,service_date,service_time,status,amount_cents,product_ids,product_cost_cents,extra_cost_cents,payment_fee_cents").order("service_date", { ascending: false }).order("service_time", { ascending: false }).order("id", { ascending: false }),
    supabase.from("payments").select("id,appointment_id,amount_cents,kind,paid_at,note").order("paid_at", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("expenses").select("id,description,category,expense_date,amount_cents").order("expense_date", { ascending: false }),
    supabase.from("studio_settings").select("monthly_goal_cents,reserve_percent").maybeSingle(),
  ]);
  fail(clientsResult.error); fail(productsResult.error); fail(appointmentsResult.error); fail(paymentsResult.error); fail(expensesResult.error); fail(settingsResult.error);
  const settings = settingsResult.data as SettingsRow | null;
  const payments = (paymentsResult.data ?? []) as PaymentRow[];
  return {
    clients: ((clientsResult.data ?? []) as ClientRow[]).map(clientFromRow),
    products: ((productsResult.data ?? []) as ProductRow[]).map(productFromRow),
    appointments: ((appointmentsResult.data ?? []) as AppointmentRow[]).map((appointment) => appointmentFromRow(appointment, payments.filter((payment) => payment.appointment_id === appointment.id))),
    expenses: ((expensesResult.data ?? []) as ExpenseRow[]).map(expenseFromRow),
    settings: {
      monthlyGoalCents: settings?.monthly_goal_cents ?? 500000,
      reservePercent: Number(settings?.reserve_percent ?? 10),
    },
  };
}

function normalizedText(value: string) {
  return value.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
}

function clientMatchKey(client: { name: string; phone: string }) {
  return `${normalizedText(client.name)}|${client.phone.replace(/\D/g, "")}`;
}

function productMatchKey(product: { name: string; purchasePriceCents: number; totalAmount: number; unit: string; usePerService: number }) {
  return [normalizedText(product.name), product.purchasePriceCents, product.totalAmount, product.unit, product.usePerService].join("|");
}

function appointmentMatchKey(appointment: { clientName: string; service: string; serviceDate: string; serviceTime: string; amountCents: number }) {
  return [normalizedText(appointment.clientName), normalizedText(appointment.service), appointment.serviceDate, appointment.serviceTime, appointment.amountCents].join("|");
}

function expenseMatchKey(expense: { description: string; category: string; expenseDate: string; amountCents: number }) {
  return [normalizedText(expense.description), normalizedText(expense.category), expense.expenseDate, expense.amountCents].join("|");
}

function paymentMatchKey(payment: { amountCents: number; kind: PaymentKind; paidAt: string; note: string }) {
  return [payment.amountCents, payment.kind, payment.paidAt, normalizedText(payment.note)].join("|");
}

function findImportMatch<T extends { id: number }, U extends { sourceId: number }>(
  existingItems: T[],
  importedItem: U,
  matchedIds: Set<number>,
  matchKey: (item: T | U) => string,
) {
  const importedKey = matchKey(importedItem);
  return existingItems.find((item) => !matchedIds.has(item.id) && item.id === importedItem.sourceId && matchKey(item) === importedKey)
    ?? existingItems.find((item) => !matchedIds.has(item.id) && matchKey(item) === importedKey);
}

function validatePaymentMerge(current: Awaited<ReturnType<typeof getStudioData>>, backup: StudioBackup) {
  const matchedAppointmentIds = new Set<number>();
  const existingBySourceId = new Map<number, (typeof current.appointments)[number]>();

  for (const importedAppointment of backup.appointments) {
    const existing = findImportMatch(current.appointments, importedAppointment, matchedAppointmentIds, appointmentMatchKey);
    if (!existing) continue;
    matchedAppointmentIds.add(existing.id);
    existingBySourceId.set(importedAppointment.sourceId, existing);
  }

  for (const importedAppointment of backup.appointments) {
    const existingAppointment = existingBySourceId.get(importedAppointment.sourceId);
    if (!existingAppointment) continue;

    const matchedPaymentIds = new Set<number>();
    let mergedPaidCents = existingAppointment.paidCents;
    for (const importedPayment of backup.payments.filter((payment) => payment.appointmentId === importedAppointment.sourceId)) {
      const existingPayment = findImportMatch(existingAppointment.payments, importedPayment, matchedPaymentIds, paymentMatchKey);
      if (existingPayment) {
        matchedPaymentIds.add(existingPayment.id);
        continue;
      }
      mergedPaidCents += importedPayment.amountCents;
    }

    if (mergedPaidCents > existingAppointment.amountCents) {
      throw new Error(`A mesclagem deixaria o valor recebido de ${existingAppointment.clientName} acima do valor do atendimento. Revise os pagamentos desse backup antes de importar.`);
    }
  }
}

export async function importStudioBackup(backup: StudioBackup): Promise<StudioImportResult> {
  if (backup.format !== "studio-em-dia" || backup.version !== 1) throw new Error("Este arquivo não é um backup compatível do Studio em Dia.");
  const { data: authData, error: authError } = await supabase.auth.getUser();
  fail(authError);
  if (!authData.user) throw new Error("Entre novamente antes de importar o backup.");

  const current = await getStudioData();
  validatePaymentMerge(current, backup);
  let added = 0;
  let kept = 0;

  const clientIds = new Map<number, number>();
  const knownClients = [...current.clients];
  const matchedClientIds = new Set<number>();
  for (const client of backup.clients) {
    const existing = findImportMatch(knownClients, client, matchedClientIds, clientMatchKey);
    if (existing) {
      clientIds.set(client.sourceId, existing.id);
      matchedClientIds.add(existing.id);
      kept += 1;
      continue;
    }
    const result = await supabase.from("clients").insert({
      name: client.name,
      phone: client.phone || null,
      notes: client.notes || null,
      created_at: client.createdAt,
    }).select("id,name,phone,notes,created_at").single();
    fail(result.error);
    const inserted = result.data as ClientRow | null;
    if (!inserted) throw new Error("Não foi possível confirmar uma cliente importada.");
    const mapped = clientFromRow(inserted);
    knownClients.push(mapped);
    clientIds.set(client.sourceId, mapped.id);
    matchedClientIds.add(mapped.id);
    added += 1;
  }

  const knownProducts = [...current.products];
  const productIds = new Map<number, number>();
  const matchedProductIds = new Set<number>();
  for (const product of backup.products) {
    const existing = findImportMatch(knownProducts, product, matchedProductIds, productMatchKey);
    if (existing) {
      productIds.set(product.sourceId, existing.id);
      matchedProductIds.add(existing.id);
      kept += 1;
      continue;
    }
    const result = await supabase.from("products").insert({
      name: product.name,
      purchase_price_cents: product.purchasePriceCents,
      total_amount: product.totalAmount,
      unit: product.unit,
      use_per_service: product.usePerService,
    }).select("id,name,purchase_price_cents,total_amount,unit,use_per_service").single();
    fail(result.error);
    if (!result.data) throw new Error("Não foi possível confirmar um produto importado.");
    const inserted = productFromRow(result.data as ProductRow);
    knownProducts.push(inserted);
    productIds.set(product.sourceId, inserted.id);
    matchedProductIds.add(inserted.id);
    added += 1;
  }

  const appointmentIds = new Map<number, number>();
  const knownAppointments = [...current.appointments];
  const matchedAppointmentIds = new Set<number>();
  for (const appointment of backup.appointments) {
    const existing = findImportMatch(knownAppointments, appointment, matchedAppointmentIds, appointmentMatchKey);
    if (existing) {
      appointmentIds.set(appointment.sourceId, existing.id);
      matchedAppointmentIds.add(existing.id);
      kept += 1;
      continue;
    }
    const result = await supabase.from("appointments").insert({
      client_id: appointment.clientId === null ? null : clientIds.get(appointment.clientId) ?? null,
      client_name: appointment.clientName,
      service: appointment.service,
      service_date: appointment.serviceDate,
      service_time: appointment.serviceTime || null,
      status: appointment.status,
      amount_cents: appointment.amountCents,
      product_ids: appointment.productIds.map((id) => productIds.get(id)).filter((id): id is number => id !== undefined),
      product_cost_cents: appointment.productCostCents,
      extra_cost_cents: appointment.extraCostCents,
      payment_fee_cents: appointment.paymentFeeCents,
    }).select("id,client_id,client_name,service,service_date,service_time,status,amount_cents,product_ids,product_cost_cents,extra_cost_cents,payment_fee_cents").single();
    fail(result.error);
    const inserted = result.data as AppointmentRow | null;
    if (!inserted) throw new Error("Não foi possível confirmar um atendimento importado.");
    const mapped = appointmentFromRow(inserted, []);
    knownAppointments.push(mapped);
    appointmentIds.set(appointment.sourceId, mapped.id);
    matchedAppointmentIds.add(mapped.id);
    added += 1;
  }

  const knownExpenses = [...current.expenses];
  const matchedExpenseIds = new Set<number>();
  for (const expense of backup.expenses) {
    const existing = findImportMatch(knownExpenses, expense, matchedExpenseIds, expenseMatchKey);
    if (existing) {
      matchedExpenseIds.add(existing.id);
      kept += 1;
      continue;
    }
    const result = await supabase.from("expenses").insert({
      description: expense.description,
      category: expense.category,
      expense_date: expense.expenseDate,
      amount_cents: expense.amountCents,
    }).select("id,description,category,expense_date,amount_cents").single();
    fail(result.error);
    if (!result.data) throw new Error("Não foi possível confirmar um gasto importado.");
    const inserted = expenseFromRow(result.data as ExpenseRow);
    knownExpenses.push(inserted);
    matchedExpenseIds.add(inserted.id);
    added += 1;
  }

  const matchedPaymentIds = new Set<number>();
  for (const payment of backup.payments) {
    const appointmentId = appointmentIds.get(payment.appointmentId);
    if (!appointmentId) throw new Error("O backup contém um pagamento sem atendimento correspondente.");
    const appointment = knownAppointments.find((item) => item.id === appointmentId);
    if (!appointment) throw new Error("Não foi possível localizar o atendimento de um pagamento.");
    const existing = findImportMatch(appointment.payments, payment, matchedPaymentIds, paymentMatchKey);
    if (existing) {
      matchedPaymentIds.add(existing.id);
      kept += 1;
      continue;
    }
    const paidCents = appointment.payments.reduce((sum, item) => sum + item.amountCents, 0);
    if (paidCents + payment.amountCents > appointment.amountCents) {
      throw new Error(`O pagamento importado de ${appointment.clientName} ultrapassa o valor do atendimento.`);
    }
    const result = await supabase.from("payments").insert({
      appointment_id: appointmentId,
      amount_cents: payment.amountCents,
      kind: payment.kind,
      paid_at: payment.paidAt,
      note: payment.note || null,
    }).select("id,amount_cents,kind,paid_at,note").single();
    fail(result.error);
    if (!result.data) throw new Error("Não foi possível confirmar um pagamento importado.");
    const insertedPayment = {
      id: result.data.id,
      amountCents: result.data.amount_cents,
      kind: result.data.kind as PaymentKind,
      paidAt: result.data.paid_at,
      note: result.data.note ?? "",
    };
    appointment.payments.push(insertedPayment);
    matchedPaymentIds.add(insertedPayment.id);
    added += 1;
  }

  const settingsResult = await supabase.from("studio_settings").select("user_id").maybeSingle();
  fail(settingsResult.error);
  if (!settingsResult.data) {
    const result = await supabase.from("studio_settings").insert({
      user_id: authData.user.id,
      monthly_goal_cents: backup.settings.monthlyGoalCents,
      reserve_percent: backup.settings.reservePercent,
    });
    fail(result.error);
    added += 1;
  } else {
    kept += 1;
  }

  return { added, kept };
}

export async function studioRequest(url: string, init?: RequestInit) {
  const method = init?.method ?? "GET";
  const payload = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
  const path = new URL(url, window.location.origin);

  if (method === "POST" && path.pathname.endsWith("/appointments")) {
    const { productIds, productCostCents } = await productSelection(payload.productIds);
    const clientId = Number(payload.clientId);
    const clientResult = await supabase.from("clients").select("id,name").eq("id", clientId).maybeSingle();
    fail(clientResult.error);
    if (!clientResult.data) throw new Error("Escolha uma cliente cadastrada.");
    const amountCents = Number(payload.amountCents);
    const depositCents = Math.max(0, Number(payload.depositCents ?? 0));
    if (depositCents > amountCents) throw new Error("O sinal não pode ser maior que o valor do atendimento.");
    const result = await supabase.from("appointments").insert({
      client_id: clientResult.data.id, client_name: clientResult.data.name, service: String(payload.service ?? "").trim(), service_date: payload.serviceDate,
      service_time: payload.serviceTime, status: "scheduled",
      amount_cents: amountCents, product_ids: productIds, product_cost_cents: productCostCents,
      extra_cost_cents: Math.max(0, Number(payload.extraCostCents ?? 0)), payment_fee_cents: Math.max(0, Number(payload.paymentFeeCents ?? 0)),
    }).select("id").single();
    fail(result.error);
    const appointmentId = result.data?.id;
    if (!appointmentId) throw new Error("Não foi possível identificar o atendimento criado.");
    if (depositCents > 0) {
      const paymentResult = await supabase.from("payments").insert({ appointment_id: appointmentId, amount_cents: depositCents, kind: "deposit", paid_at: payload.depositPaidAt });
      if (paymentResult.error) {
        await supabase.from("appointments").delete().eq("id", appointmentId);
        fail(paymentResult.error);
      }
    }
    return { ok: true };
  }

  if (method === "PUT" && path.pathname.endsWith("/appointments")) {
    if ("status" in payload) {
      const appointmentId = Number(payload.id);
      const allowedStatuses: AppointmentStatus[] = ["scheduled", "confirmed", "completed", "cancelled"];
      const status = String(payload.status ?? "") as AppointmentStatus;
      if (!Number.isInteger(appointmentId) || appointmentId <= 0) throw new Error("Atendimento inválido.");
      if (!allowedStatuses.includes(status)) throw new Error("Status de atendimento inválido.");
      const result = await supabase.from("appointments").update({ status }).eq("id", appointmentId).select("id,status").single();
      fail(result.error);
      if (result.data?.id !== appointmentId || result.data.status !== status) throw new Error("Não foi possível confirmar a atualização deste atendimento.");
      return { ok: true };
    }
    const appointmentId = Number(payload.id);
    const clientId = Number(payload.clientId);
    const amountCents = Number(payload.amountCents);
    const service = String(payload.service ?? "").trim();
    const serviceTime = String(payload.serviceTime ?? "").trim();
    if (!Number.isInteger(appointmentId) || !Number.isInteger(clientId)) throw new Error("Atendimento inválido.");
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Informe um valor válido para o atendimento.");
    if (!service || !serviceTime) throw new Error("Informe os serviços e o horário do atendimento.");
    const [clientResult, paymentsResult] = await Promise.all([
      supabase.from("clients").select("id,name").eq("id", clientId).maybeSingle(),
      supabase.from("payments").select("amount_cents").eq("appointment_id", appointmentId),
    ]);
    fail(clientResult.error); fail(paymentsResult.error);
    if (!clientResult.data) throw new Error("Escolha uma cliente cadastrada.");
    const paidCents = (paymentsResult.data ?? []).reduce((sum, payment) => sum + payment.amount_cents, 0);
    if (amountCents < paidCents) throw new Error("O valor do atendimento não pode ser menor que o total já recebido.");
    const update: Record<string, unknown> = {
      client_id: clientResult.data.id,
      client_name: clientResult.data.name,
      service,
      service_date: payload.serviceDate,
      service_time: serviceTime,
      amount_cents: amountCents,
      extra_cost_cents: Math.max(0, Number(payload.extraCostCents ?? 0)),
      payment_fee_cents: Math.max(0, Number(payload.paymentFeeCents ?? 0)),
    };
    if (payload.productsChanged === true) {
      const { productIds, productCostCents } = await productSelection(payload.productIds);
      update.product_ids = productIds;
      update.product_cost_cents = productCostCents;
    }
    const result = await supabase.from("appointments").update(update).eq("id", appointmentId);
    fail(result.error); return { ok: true };
  }

  if (method === "POST" && path.pathname.endsWith("/payments")) {
    const appointmentId = Number(payload.appointmentId);
    const amountCents = Number(payload.amountCents);
    const allowedKinds: PaymentKind[] = ["deposit", "partial", "final"];
    const kind = String(payload.kind ?? "") as PaymentKind;
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Informe um valor de pagamento válido.");
    if (!allowedKinds.includes(kind)) throw new Error("Tipo de pagamento inválido.");
    const [appointmentResult, paymentsResult] = await Promise.all([
      supabase.from("appointments").select("amount_cents").eq("id", appointmentId).maybeSingle(),
      supabase.from("payments").select("amount_cents").eq("appointment_id", appointmentId),
    ]);
    fail(appointmentResult.error); fail(paymentsResult.error);
    if (!appointmentResult.data) throw new Error("Atendimento não encontrado.");
    const paidCents = (paymentsResult.data ?? []).reduce((sum, payment) => sum + payment.amount_cents, 0);
    if (amountCents > appointmentResult.data.amount_cents - paidCents) throw new Error("O pagamento não pode ser maior que o valor pendente.");
    const result = await supabase.from("payments").insert({ appointment_id: appointmentId, amount_cents: amountCents, kind, paid_at: payload.paidAt, note: String(payload.note ?? "").trim() || null });
    fail(result.error); return { ok: true };
  }

  if (method === "PUT" && path.pathname.endsWith("/payments")) {
    const paymentId = Number(payload.id);
    const amountCents = Number(payload.amountCents);
    const allowedKinds: PaymentKind[] = ["deposit", "partial", "final", "full"];
    const kind = String(payload.kind ?? "") as PaymentKind;
    if (!Number.isInteger(paymentId) || !Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Informe um pagamento válido.");
    if (!allowedKinds.includes(kind)) throw new Error("Tipo de pagamento inválido.");
    const paymentResult = await supabase.from("payments").select("id,appointment_id").eq("id", paymentId).maybeSingle();
    fail(paymentResult.error);
    if (!paymentResult.data) throw new Error("Pagamento não encontrado.");
    const [appointmentResult, paymentsResult] = await Promise.all([
      supabase.from("appointments").select("amount_cents").eq("id", paymentResult.data.appointment_id).maybeSingle(),
      supabase.from("payments").select("id,amount_cents").eq("appointment_id", paymentResult.data.appointment_id).neq("id", paymentId),
    ]);
    fail(appointmentResult.error); fail(paymentsResult.error);
    if (!appointmentResult.data) throw new Error("Atendimento não encontrado.");
    const otherPaymentsCents = (paymentsResult.data ?? []).reduce((sum, payment) => sum + payment.amount_cents, 0);
    if (amountCents > appointmentResult.data.amount_cents - otherPaymentsCents) throw new Error("O pagamento não pode ser maior que o valor pendente.");
    const result = await supabase.from("payments").update({
      amount_cents: amountCents,
      kind,
      paid_at: payload.paidAt,
      note: String(payload.note ?? "").trim() || null,
    }).eq("id", paymentId);
    fail(result.error); return { ok: true };
  }

  if (method === "POST" && path.pathname.endsWith("/clients")) {
    const result = await supabase.from("clients").insert({
      name: String(payload.name ?? "").trim(),
      phone: String(payload.phone ?? "").trim() || null,
      notes: String(payload.notes ?? "").trim() || null,
    });
    fail(result.error); return { ok: true };
  }

  if (method === "PUT" && path.pathname.endsWith("/clients")) {
    const id = Number(payload.id);
    const result = await supabase.from("clients").update({
      name: String(payload.name ?? "").trim(),
      phone: String(payload.phone ?? "").trim() || null,
      notes: String(payload.notes ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    fail(result.error); return { ok: true };
  }

  if (method === "POST" && path.pathname.endsWith("/expenses")) {
    const result = await supabase.from("expenses").insert({ description: String(payload.description ?? "").trim(), category: payload.category, expense_date: payload.expenseDate, amount_cents: payload.amountCents });
    fail(result.error); return { ok: true };
  }

  if (method === "POST" && path.pathname.endsWith("/products")) {
    const result = await supabase.from("products").insert(productPayload(payload));
    fail(result.error); return { ok: true };
  }

  if (method === "PUT" && path.pathname.endsWith("/products")) {
    const productId = Number(payload.id);
    if (!Number.isInteger(productId) || productId <= 0) throw new Error("Produto inválido.");
    const result = await supabase.from("products").update(productPayload(payload)).eq("id", productId).select("id").single();
    fail(result.error);
    if (result.data?.id !== productId) throw new Error("Não foi possível confirmar a alteração do produto.");
    return { ok: true };
  }

  if (method === "PUT" && path.pathname.endsWith("/settings")) {
    const { data: userData, error: userError } = await supabase.auth.getUser(); fail(userError);
    if (!userData.user) throw new Error("Entre novamente para salvar as preferências.");
    const result = await supabase.from("studio_settings").upsert({ user_id: userData.user.id, monthly_goal_cents: payload.monthlyGoalCents, reserve_percent: payload.reservePercent }, { onConflict: "user_id" });
    fail(result.error); return { ok: true };
  }

  if (method === "DELETE") {
    const table = path.pathname.split("/").pop();
    if (!table || !["appointments", "clients", "expenses", "products", "payments"].includes(table)) throw new Error("Registro inválido.");
    const id = Number(path.searchParams.get("id"));
    const result = await supabase.from(table).delete().eq("id", id);
    fail(result.error); return { ok: true };
  }

  throw new Error("Operação não reconhecida.");
}
