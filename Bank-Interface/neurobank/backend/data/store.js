// In-memory store — replace with a real DB (PostgreSQL/MongoDB) in production
import bcrypt from "bcryptjs";

const hash = (p) => bcrypt.hashSync(p, 10);

export const users = [
  {
    id: "u1",
    name: "Alex Mercer",
    email: "alex@neurobank.io",
    passwordHash: hash("password123"),
    tier: "Premium",
  },
];

export const accounts = [
  { id: "acc1", userId: "u1", name: "Neuro Checking", number: "****4920", balance: 124592.40, type: "checking" },
  { id: "acc2", userId: "u1", name: "Quantum Yield Vault", number: "****8811", balance: 45000.00, type: "savings" },
];

export const transactions = [
  { id: "t1", accountId: "acc1", icon: "shopping_bag", name: "Apple Store", category: "Technology", time: "Today, 14:32", card: "**4921", amount: -1299.00 },
  { id: "t2", accountId: "acc1", icon: "restaurant", name: "Soma Sushi Bar", category: "Dining", time: "Today, 12:15", card: "**4921", amount: -85.40 },
  { id: "t3", accountId: "acc1", icon: "arrow_downward", name: "Payroll Deposit", category: "Income", time: "Nov 15, 08:00", card: "ACH", amount: 4250.00 },
  { id: "t4", accountId: "acc1", icon: "subscriptions", name: "Netflix Premium", category: "Entertainment", time: "Nov 14, 00:00", card: "**4921", amount: -22.99 },
  { id: "t5", accountId: "acc1", icon: "bolt", name: "Electric Utility", category: "Bills", time: "Nov 13, 10:00", card: "**4921", amount: -145.82 },
  { id: "t6", accountId: "acc1", icon: "local_gas_station", name: "Shell Station", category: "Transport", time: "Nov 12, 17:30", card: "**8092", amount: -62.40 },
  { id: "t7", accountId: "acc1", icon: "arrow_downward", name: "Wire Transfer In", category: "Income", time: "Nov 10, 09:15", card: "WIRE", amount: 12000.00 },
  { id: "t8", accountId: "acc1", icon: "flight", name: "Delta Airlines", category: "Travel", time: "Nov 08, 06:45", card: "**4921", amount: -680.00 },
];

export const cards = [
  { id: "c1", userId: "u1", name: "Neuro Titanium", number: "•••• •••• •••• 8092", expiry: "12/28", holder: "ALEXANDER CHEN", frozen: false, limits: { online: true, international: false, atm: true } },
];
