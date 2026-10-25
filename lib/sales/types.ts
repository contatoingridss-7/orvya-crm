export type SalesPeriod = {
  id: string;
  kind: "vendas" | "servicos";
  start: string;
  end: string;
  itemCount: number;
  totalQty: number;
  /** null para quem não é gestor/admin (o banco não entrega o valor). */
  totalValue: number | null;
  createdAt: string;
};

export type ProductSales = {
  productId: string | null;
  code: string | null;
  name: string;
  unit: string | null;
  isRental: boolean;
  qty: number;
  total: number | null;
};

export const brDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const periodLabel = (p: { start: string; end: string }) => `${brDate(p.start)} a ${brDate(p.end)}`;
