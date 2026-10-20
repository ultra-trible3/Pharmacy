/**
 * Deterministic development/demo seed.
 *
 * Produces a realistic Egyptian pharmacy dataset:
 *  - one account per role (Argon2id hashes),
 *  - two warehouses (صالة البيع / المخزن الرئيسي),
 *  - categories, suppliers, ~30 products with Arabic names,
 *  - batches with healthy / near-expiry / expired stock so that FEFO, low-stock
 *    and expiry alerts can be demonstrated and tested against real data.
 *
 * Run with:  pnpm --filter @pharmacy/server db:seed
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';
import { ean13CheckDigit } from '@pharmacy/shared';

const prisma = new PrismaClient();

/** All demo accounts share this password (>= 8 chars, letters + digits). */
export const DEMO_PASSWORD = 'Pharma@2024';

const DAY = 86_400_000;

function isoDay(offsetDays: number): Date {
  const now = new Date();
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const d = new Date(utc + offsetDays * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Egypt uses GS1 prefix 622; generate a check-digit-correct EAN-13. */
function makeBarcode(sequence: number): string {
  const body = `622${String(sequence).padStart(9, '0')}`.slice(0, 12);
  return `${body}${ean13CheckDigit(body)}`;
}

const USERS = [
  { username: 'owner', fullName: 'أحمد عبد الرحمن', role: 'OWNER', email: 'owner@pharmacy.local' },
  { username: 'manager', fullName: 'محمود السيد', role: 'MANAGER', email: 'manager@pharmacy.local' },
  { username: 'pharmacist', fullName: 'سارة إبراهيم', role: 'PHARMACIST', email: 'pharmacist@pharmacy.local' },
  { username: 'cashier', fullName: 'منى مصطفى', role: 'CASHIER', email: 'cashier@pharmacy.local' },
  { username: 'inventory', fullName: 'خالد فتحي', role: 'INVENTORY_CLERK', email: 'inventory@pharmacy.local' },
  { username: 'accountant', fullName: 'هالة سمير', role: 'ACCOUNTANT', email: 'accountant@pharmacy.local' },
] as const;

const CATEGORIES = [
  { code: 'ANALGESIC', nameAr: 'مسكنات وخوافض حرارة', nameEn: 'Analgesics' },
  { code: 'ANTIBIOTIC', nameAr: 'مضادات حيوية', nameEn: 'Antibiotics' },
  { code: 'CARDIO', nameAr: 'أدوية القلب والضغط', nameEn: 'Cardiovascular' },
  { code: 'DIABETES', nameAr: 'أدوية السكري', nameEn: 'Diabetes' },
  { code: 'RESPIRATORY', nameAr: 'أدوية الجهاز التنفسي', nameEn: 'Respiratory' },
  { code: 'GASTRO', nameAr: 'أدوية الجهاز الهضمي', nameEn: 'Gastrointestinal' },
  { code: 'VITAMIN', nameAr: 'فيتامينات ومكملات', nameEn: 'Vitamins & Supplements' },
  { code: 'DERMA', nameAr: 'العناية بالبشرة', nameEn: 'Dermatology' },
  { code: 'MEDICAL_SUPPLY', nameAr: 'مستلزمات طبية', nameEn: 'Medical Supplies' },
];

const SUPPLIERS = [
  { code: 'SUP-IBM', nameAr: 'شركة ابن سينا للأدوية', phone: '02-23456789', balance: 12500.5 },
  { code: 'SUP-NILE', nameAr: 'النيل فارما للتوزيع', phone: '03-4258761', balance: 8420 },
  { code: 'SUP-EVA', nameAr: 'إيفا فارما', phone: '02-24567890', balance: 0 },
  { code: 'SUP-AMOUN', nameAr: 'أمون للصناعات الدوائية', phone: '02-25678901', balance: 3310.75 },
  { code: 'SUP-GP', nameAr: 'المصرية لتجارة الأدوية', phone: '015-5551234', balance: 0 },
];

interface SeedProduct {
  sku: string;
  nameAr: string;
  nameEn: string;
  brand?: string;
  manufacturer: string;
  category: string;
  dosageForm: string;
  strength: string;
  packSize: string;
  unit: string;
  activeIngredient: string;
  cost: string;
  price: string;
  minStock: number;
  rx?: 'OTC' | 'PRESCRIPTION' | 'CONTROLLED';
  tax?: string;
}

const PRODUCTS: SeedProduct[] = [
  { sku: 'MED-0001', nameAr: 'باراسيتامول 500 مجم أقراص', nameEn: 'Paracetamol 500mg Tablets', brand: 'بانادول', manufacturer: 'جلاكسو سميث كلاين', category: 'ANALGESIC', dosageForm: 'TABLET', strength: '500 مجم', packSize: '24 قرص', unit: 'علبة', activeIngredient: 'باراسيتامول', cost: '18.50', price: '27.00', minStock: 20 },
  { sku: 'MED-0002', nameAr: 'إيبوبروفين 400 مجم أقراص', nameEn: 'Ibuprofen 400mg Tablets', brand: 'بروفين', manufacturer: 'أمون للصناعات الدوائية', category: 'ANALGESIC', dosageForm: 'TABLET', strength: '400 مجم', packSize: '20 قرص', unit: 'علبة', activeIngredient: 'إيبوبروفين', cost: '22.00', price: '32.50', minStock: 15 },
  { sku: 'MED-0003', nameAr: 'أسبرين 75 مجم أقراص', nameEn: 'Aspirin 75mg Tablets', manufacturer: 'المصرية لتجارة الأدوية', category: 'CARDIO', dosageForm: 'TABLET', strength: '75 مجم', packSize: '30 قرص', unit: 'علبة', activeIngredient: 'حمض أسيتيل ساليسيليك', cost: '14.00', price: '21.00', minStock: 10 },
  { sku: 'MED-0004', nameAr: 'ديكلوفيناك جل 1%', nameEn: 'Diclofenac Gel 1%', brand: 'فولتارين', manufacturer: 'نوفارتس', category: 'ANALGESIC', dosageForm: 'GEL', strength: '1%', packSize: '50 جم', unit: 'أنبوبة', activeIngredient: 'ديكلوفيناك الصوديوم', cost: '48.00', price: '69.00', minStock: 8 },
  { sku: 'MED-0005', nameAr: 'أموكسيسيلين 500 مجم كبسولات', nameEn: 'Amoxicillin 500mg Capsules', manufacturer: 'إيفا فارما', category: 'ANTIBIOTIC', dosageForm: 'CAPSULE', strength: '500 مجم', packSize: '16 كبسولة', unit: 'علبة', activeIngredient: 'أموكسيسيلين', cost: '36.00', price: '52.00', minStock: 25, rx: 'PRESCRIPTION' },
  { sku: 'MED-0006', nameAr: 'أزيثرومايسين 500 مجم أقراص', nameEn: 'Azithromycin 500mg Tablets', brand: 'زيثروماكس', manufacturer: 'فايزر', category: 'ANTIBIOTIC', dosageForm: 'TABLET', strength: '500 مجم', packSize: '3 أقراص', unit: 'علبة', activeIngredient: 'أزيثرومايسين', cost: '52.00', price: '75.00', minStock: 10, rx: 'PRESCRIPTION' },
  { sku: 'MED-0007', nameAr: 'سيبروفلوكساسين 500 مجم أقراص', nameEn: 'Ciprofloxacin 500mg Tablets', manufacturer: 'ابن سينا فارما', category: 'ANTIBIOTIC', dosageForm: 'TABLET', strength: '500 مجم', packSize: '10 أقراص', unit: 'علبة', activeIngredient: 'سيبروفلوكساسين', cost: '40.00', price: '58.00', minStock: 12, rx: 'PRESCRIPTION' },
  { sku: 'MED-0008', nameAr: 'ميترونيدازول 500 مجم أقراص', nameEn: 'Metronidazole 500mg Tablets', manufacturer: 'أمون للصناعات الدوائية', category: 'ANTIBIOTIC', dosageForm: 'TABLET', strength: '500 مجم', packSize: '20 قرص', unit: 'علبة', activeIngredient: 'ميترونيدازول', cost: '16.00', price: '24.00', minStock: 10, rx: 'PRESCRIPTION' },
  { sku: 'MED-0009', nameAr: 'أملوديبين 5 مجم أقراص', nameEn: 'Amlodipine 5mg Tablets', manufacturer: 'النيل فارما', category: 'CARDIO', dosageForm: 'TABLET', strength: '5 مجم', packSize: '30 قرص', unit: 'علبة', activeIngredient: 'أملوديبين بيزيلات', cost: '26.00', price: '38.00', minStock: 15, rx: 'PRESCRIPTION' },
  { sku: 'MED-0010', nameAr: 'أتينولول 50 مجم أقراص', nameEn: 'Atenolol 50mg Tablets', manufacturer: 'النيل فارما', category: 'CARDIO', dosageForm: 'TABLET', strength: '50 مجم', packSize: '20 قرص', unit: 'علبة', activeIngredient: 'أتينولول', cost: '19.00', price: '28.00', minStock: 12, rx: 'PRESCRIPTION' },
  { sku: 'MED-0011', nameAr: 'أتورفاستاتين 20 مجم أقراص', nameEn: 'Atorvastatin 20mg Tablets', brand: 'ليبيتور', manufacturer: 'فايزر', category: 'CARDIO', dosageForm: 'TABLET', strength: '20 مجم', packSize: '30 قرص', unit: 'علبة', activeIngredient: 'أتورفاستاتين', cost: '85.00', price: '120.00', minStock: 10, rx: 'PRESCRIPTION' },
  { sku: 'MED-0012', nameAr: 'ميتفورمين 850 مجم أقراص', nameEn: 'Metformin 850mg Tablets', manufacturer: 'إيفا فارما', category: 'DIABETES', dosageForm: 'TABLET', strength: '850 مجم', packSize: '30 قرص', unit: 'علبة', activeIngredient: 'ميتفورمين هيدروكلوريد', cost: '28.00', price: '41.00', minStock: 20, rx: 'PRESCRIPTION' },
  { sku: 'MED-0013', nameAr: 'جليمبيريد 2 مجم أقراص', nameEn: 'Glimepiride 2mg Tablets', brand: 'أماريل', manufacturer: 'سانوفي', category: 'DIABETES', dosageForm: 'TABLET', strength: '2 مجم', packSize: '30 قرص', unit: 'علبة', activeIngredient: 'جليمبيريد', cost: '44.00', price: '64.00', minStock: 10, rx: 'PRESCRIPTION' },
  { sku: 'MED-0014', nameAr: 'إنسولين قلم 100 وحدة/مل', nameEn: 'Insulin Pen 100IU/ml', brand: 'لانتوس', manufacturer: 'سانوفي', category: 'DIABETES', dosageForm: 'INJECTION', strength: '100 وحدة/مل', packSize: 'قلم 3 مل', unit: 'قلم', activeIngredient: 'إنسولين جلارجين', cost: '180.00', price: '245.00', minStock: 5, rx: 'PRESCRIPTION' },
  { sku: 'MED-0015', nameAr: 'أجهزة قياس السكر شرائط', nameEn: 'Blood Glucose Test Strips', manufacturer: 'المصرية لتجارة الأدوية', category: 'DIABETES', dosageForm: 'OTHER', strength: '-', packSize: '50 شريط', unit: 'علبة', activeIngredient: '-', cost: '210.00', price: '290.00', minStock: 6 },
  { sku: 'MED-0016', nameAr: 'سالبوتامول بخاخ 100 ميكروجرام', nameEn: 'Salbutamol Inhaler 100mcg', brand: 'فنتولين', manufacturer: 'جلاكسو سميث كلاين', category: 'RESPIRATORY', dosageForm: 'INHALER', strength: '100 ميكروجرام', packSize: '200 جرعة', unit: 'بخاخ', activeIngredient: 'سالبوتامول سلفات', cost: '62.00', price: '89.00', minStock: 8, rx: 'PRESCRIPTION' },
  { sku: 'MED-0017', nameAr: 'مونتيلوكاست 10 مجم أقراص', nameEn: 'Montelukast 10mg Tablets', brand: 'سينجولير', manufacturer: 'أورجانون', category: 'RESPIRATORY', dosageForm: 'TABLET', strength: '10 مجم', packSize: '14 قرص', unit: 'علبة', activeIngredient: 'مونتيلوكاست صوديوم', cost: '120.00', price: '168.00', minStock: 6, rx: 'PRESCRIPTION' },
  { sku: 'MED-0018', nameAr: 'شراب مضاد للحساسية للأطفال', nameEn: 'Paediatric Antihistamine Syrup', brand: 'زيرتك', manufacturer: 'جلاكسو سميث كلاين', category: 'RESPIRATORY', dosageForm: 'SYRUP', strength: '1 مجم/مل', packSize: '100 مل', unit: 'زجاجة', activeIngredient: 'سيتريزين ثنائي الهيدروكلوريد', cost: '34.00', price: '49.00', minStock: 12 },
  { sku: 'MED-0019', nameAr: 'أوميبرازول 20 مجم كبسولات', nameEn: 'Omeprazole 20mg Capsules', brand: 'لوزيك', manufacturer: 'أمون للصناعات الدوائية', category: 'GASTRO', dosageForm: 'CAPSULE', strength: '20 مجم', packSize: '14 كبسولة', unit: 'علبة', activeIngredient: 'أوميبرازول', cost: '46.00', price: '67.00', minStock: 15, rx: 'PRESCRIPTION' },
  { sku: 'MED-0020', nameAr: 'دومبيريدون 10 مجم أقراص', nameEn: 'Domperidone 10mg Tablets', brand: 'موتيليوم', manufacturer: 'جانسون', category: 'GASTRO', dosageForm: 'TABLET', strength: '10 مجم', packSize: '30 قرص', unit: 'علبة', activeIngredient: 'دومبيريدون', cost: '32.00', price: '46.00', minStock: 10 },
  { sku: 'MED-0021', nameAr: 'أملاح الجفاف للأطفال', nameEn: 'Oral Rehydration Salts', brand: 'ريهايدران', manufacturer: 'المصرية لتجارة الأدوية', category: 'GASTRO', dosageForm: 'SACHET', strength: '-', packSize: '10 أكياس', unit: 'علبة', activeIngredient: 'جلوكوز وأملاح', cost: '12.00', price: '18.00', minStock: 25 },
  { sku: 'MED-0022', nameAr: 'فيتامين سي 1000 مجم فوار', nameEn: 'Vitamin C 1000mg Effervescent', manufacturer: 'إيفا فارما', category: 'VITAMIN', dosageForm: 'SACHET', strength: '1000 مجم', packSize: '20 قرص فوار', unit: 'علبة', activeIngredient: 'حمض الأسكوربيك', cost: '58.00', price: '82.00', minStock: 10 },
  { sku: 'MED-0023', nameAr: 'فيتامين د3 5000 وحدة', nameEn: 'Vitamin D3 5000IU', manufacturer: 'أمون للصناعات الدوائية', category: 'VITAMIN', dosageForm: 'CAPSULE', strength: '5000 وحدة', packSize: '30 كبسولة', unit: 'علبة', activeIngredient: 'كوليكالسيفيرول', cost: '66.00', price: '94.00', minStock: 10 },
  { sku: 'MED-0024', nameAr: 'حديد + فوليك أسيد أقراص', nameEn: 'Iron + Folic Acid Tablets', manufacturer: 'النيل فارما', category: 'VITAMIN', dosageForm: 'TABLET', strength: '65 مجم', packSize: '30 قرص', unit: 'علبة', activeIngredient: 'كبريتات الحديدوز', cost: '38.00', price: '55.00', minStock: 15 },
  { sku: 'MED-0025', nameAr: 'كريم مرطب للبشرة الجافة', nameEn: 'Moisturising Cream for Dry Skin', brand: 'يوسيرين', manufacturer: 'بايرسدورف', category: 'DERMA', dosageForm: 'CREAM', strength: '10%', packSize: '100 مل', unit: 'أنبوبة', activeIngredient: 'يوريا', cost: '145.00', price: '199.00', minStock: 6 },
  { sku: 'MED-0026', nameAr: 'واقي شمس بمعامل 50', nameEn: 'Sunscreen SPF 50', manufacturer: 'إيفا فارما', category: 'DERMA', dosageForm: 'CREAM', strength: 'SPF 50', packSize: '50 مل', unit: 'أنبوبة', activeIngredient: 'أكسيد الزنك', cost: '128.00', price: '179.00', minStock: 8 },
  { sku: 'MED-0027', nameAr: 'مضاد فطري كريم 2%', nameEn: 'Antifungal Cream 2%', brand: 'كانستين', manufacturer: 'باير', category: 'DERMA', dosageForm: 'CREAM', strength: '2%', packSize: '30 جم', unit: 'أنبوبة', activeIngredient: 'كلوتريمازول', cost: '39.00', price: '56.00', minStock: 10 },
  { sku: 'MED-0028', nameAr: 'شاش طبي معقم', nameEn: 'Sterile Gauze Swabs', manufacturer: 'المصرية للمستلزمات الطبية', category: 'MEDICAL_SUPPLY', dosageForm: 'OTHER', strength: '-', packSize: '10 قطع', unit: 'باكو', activeIngredient: '-', cost: '22.00', price: '33.00', minStock: 20 },
  { sku: 'MED-0029', nameAr: 'كمامات طبية معقمة', nameEn: 'Sterile Medical Face Masks', manufacturer: 'المصرية للمستلزمات الطبية', category: 'MEDICAL_SUPPLY', dosageForm: 'OTHER', strength: '-', packSize: '50 كمامة', unit: 'علبة', activeIngredient: '-', cost: '45.00', price: '69.00', minStock: 20 },
  { sku: 'MED-0030', nameAr: 'جهاز قياس ضغط الدم الرقمي', nameEn: 'Digital Blood Pressure Monitor', manufacturer: 'أومرون', category: 'MEDICAL_SUPPLY', dosageForm: 'OTHER', strength: '-', packSize: 'جهاز', unit: 'قطعة', activeIngredient: '-', cost: '780.00', price: '1050.00', minStock: 3 },
  { sku: 'MED-0031', nameAr: 'كحول إيثيلي 70%', nameEn: 'Ethyl Alcohol 70%', manufacturer: 'المصرية للمستلزمات الطبية', category: 'MEDICAL_SUPPLY', dosageForm: 'OTHER', strength: '70%', packSize: '500 مل', unit: 'زجاجة', activeIngredient: 'إيثانول', cost: '28.00', price: '42.00', minStock: 15 },
  { sku: 'MED-0032', nameAr: 'مورفين سلفات 10 مجم/مل', nameEn: 'Morphine Sulphate 10mg/ml', manufacturer: 'المصرية لتجارة الأدوية', category: 'ANALGESIC', dosageForm: 'INJECTION', strength: '10 مجم/مل', packSize: 'أمبول 1 مل', unit: 'أمبول', activeIngredient: 'مورفين سلفات', cost: '95.00', price: '130.00', minStock: 2, rx: 'CONTROLLED' },
];

async function main(): Promise<void> {
  console.log('🌱 seeding pharmacy database...');

  // --- wipe (dependency-safe order) --------------------------------------
  await prisma.stockMovement.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.session.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();

  // --- users --------------------------------------------------------------
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users = new Map<string, string>();
  for (const user of USERS) {
    const created = await prisma.user.create({
      data: {
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        passwordHash,
      },
    });
    users.set(user.username, created.id);
  }
  console.log(`  ✓ ${users.size} users (password: ${DEMO_PASSWORD})`);

  // --- warehouses ---------------------------------------------------------
  const mainWarehouse = await prisma.warehouse.create({
    data: {
      code: 'WH-MAIN',
      nameAr: 'المخزن الرئيسي',
      nameEn: 'Main Warehouse',
      address: 'المخزن الخلفي - الدور الأرضي',
      isDefault: true,
    },
  });
  await prisma.warehouse.create({
    data: {
      code: 'WH-COUNTER',
      nameAr: 'صالة البيع',
      nameEn: 'Sales Floor',
      address: 'رف العرض الأمامي',
      isDefault: false,
    },
  });
  console.log('  ✓ 2 warehouses');

  // --- categories ---------------------------------------------------------
  const categories = new Map<string, string>();
  for (const category of CATEGORIES) {
    const created = await prisma.category.create({ data: category });
    categories.set(category.code, created.id);
  }
  console.log(`  ✓ ${categories.size} categories`);

  // --- suppliers ----------------------------------------------------------
  const suppliers: string[] = [];
  for (const supplier of SUPPLIERS) {
    const created = await prisma.supplier.create({
      data: {
        code: supplier.code,
        nameAr: supplier.nameAr,
        phone: supplier.phone,
        balance: supplier.balance.toFixed(2),
        openingBalance: supplier.balance.toFixed(2),
      },
    });
    suppliers.push(created.id);
  }
  console.log(`  ✓ ${suppliers.length} suppliers`);

  // --- products + batches -------------------------------------------------
  const ownerId = users.get('owner')!;
  const inventoryUserId = users.get('inventory')!;
  let batchCount = 0;
  let movementCount = 0;

  for (let index = 0; index < PRODUCTS.length; index += 1) {
    const item = PRODUCTS[index]!;
    const product = await prisma.product.create({
      data: {
        sku: item.sku,
        barcode: makeBarcode(index + 1),
        nameAr: item.nameAr,
        nameEn: item.nameEn,
        brand: item.brand ?? null,
        manufacturer: item.manufacturer,
        activeIngredient: item.activeIngredient === '-' ? null : item.activeIngredient,
        categoryId: categories.get(item.category) ?? null,
        dosageForm: item.dosageForm as never,
        strength: item.strength === '-' ? null : item.strength,
        packSize: item.packSize,
        unit: item.unit,
        costPrice: item.cost,
        salePrice: item.price,
        taxRate: item.tax ?? '0.00',
        minStock: item.minStock,
        prescriptionClass: (item.rx ?? 'OTC') as never,
        createdById: ownerId,
      },
    });

    // Batches: [quantity, expiryOffsetDays, lotSuffix, supplierIndex]
    const batchPlan: Array<[number, number, string, number]> = [
      [Math.max(item.minStock * 2, 10), 400 + index * 3, 'A', index % suppliers.length],
      [Math.max(Math.floor(item.minStock / 2), 2), 45 + (index % 40), 'B', (index + 1) % suppliers.length],
    ];
    if (index % 5 === 0) {
      // A few products carry an already-expired batch to exercise the alerts.
      batchPlan.push([4, -(10 + index), 'X', (index + 2) % suppliers.length]);
    }
    if (index % 7 === 0) {
      // And a couple of very low-stock products (below their threshold).
      batchPlan[0] = [1, 400 + index * 3, 'C', index % suppliers.length];
      batchPlan[1] = [0, 45 + (index % 40), 'D', (index + 1) % suppliers.length];
    }

    for (const [quantity, expiryOffset, suffix, supplierIndex] of batchPlan) {
      const lotNumber = `LOT-${item.sku.replace('MED-', '')}${suffix}`;
      const expiryDate = isoDay(expiryOffset);
      const supplierId = suppliers[supplierIndex] ?? null;

      // Upsert semantics for the batch (quantity accumulated).
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO batches (id, "productId", "warehouseId", "supplierId", "lotNumber", "expiryDate",
          quantity, "costPrice", "receivedAt", "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, ${product.id}, ${mainWarehouse.id}, ${supplierId}, ${lotNumber},
          ${expiryDate}::date, ${quantity}, ${item.cost}::numeric, now(), now(), now())
        ON CONFLICT ("productId", "warehouseId", "lotNumber", "expiryDate")
        DO UPDATE SET quantity = batches.quantity + EXCLUDED.quantity, "updatedAt" = now()
        RETURNING id
      `;
      const batchId = rows[0]!.id;
      batchCount += 1;

      if (quantity > 0) {
        await prisma.stockMovement.create({
          data: {
            productId: product.id,
            batchId,
            warehouseId: mainWarehouse.id,
            type: 'RECEIPT',
            quantity,
            unitCost: item.cost,
            reason: 'رصيد افتتاحي',
            reference: 'OPENING',
            userId: inventoryUserId,
          },
        });
        movementCount += 1;
      }
    }
  }

  console.log(`  ✓ ${PRODUCTS.length} products`);
  console.log(`  ✓ ${batchCount} batches / ${movementCount} stock movements`);

  const expiredCount = await prisma.batch.count({
    where: { quantity: { gt: 0 }, expiryDate: { lt: new Date() } },
  });
  console.log(`  ✓ ${expiredCount} expired batches available for alert testing`);
  console.log('\n✅ seed complete\n');
  console.log('Demo accounts (all share the same password):');
  for (const user of USERS) {
    console.log(`  ${user.role.padEnd(16)} ${user.username.padEnd(12)} ${DEMO_PASSWORD}`);
  }
}

main()
  .catch((error) => {
    console.error('❌ seed failed');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
