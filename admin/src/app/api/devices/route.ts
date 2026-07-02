import { NextResponse } from 'next/server';

// Server-side global in-memory state
// Using global variable to persist across hot reloads in Next.js development
const globalSymbols = Symbol.for('sairam.devices');
if (!(global as any)[globalSymbols]) {
  (global as any)[globalSymbols] = [
    {
      id: "DEV-102934",
      device_id: "DEV-102934",
      device_name: "Manager Samsung Tab",
      android_version: "14",
      app_version: "1.0.0",
      manufacturer: "Samsung",
      status: "approved",
      requested_at: new Date(Date.now() - 86400000 * 5).toISOString()
    },
    {
      id: "DEV-583920",
      device_id: "DEV-583920",
      device_name: "Cashier M34",
      android_version: "15",
      app_version: "1.0.0",
      manufacturer: "Samsung",
      status: "pending",
      requested_at: new Date().toISOString()
    }
  ];
}

const devicesStore = (global as any)[globalSymbols];

export async function GET() {
  return NextResponse.json(devicesStore);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'register') {
      const { device } = body;
      const idx = devicesStore.findIndex((d: any) => d.device_id === device.device_id);
      if (idx !== -1) {
        devicesStore[idx] = { ...devicesStore[idx], ...device, status: 'pending' };
      } else {
        devicesStore.push({ ...device, status: 'pending' });
      }
      return NextResponse.json({ success: true, device });
    }

    if (action === 'update_status') {
      const { device_id, status } = body;
      const idx = devicesStore.findIndex((d: any) => d.device_id === device_id);
      if (idx !== -1) {
        devicesStore[idx].status = status;
        return NextResponse.json({ success: true, device: devicesStore[idx] });
      }
      return NextResponse.json({ success: false, error: 'Device not found' }, { status: 404 });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
