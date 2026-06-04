export interface DeviceEntry {
  name: string;
  vendorId: number;
  productId: number;
  deviceType: string;
}

export const deviceCatalog: DeviceEntry[] = [
  {
    name: 'Airspy (Mini / R2 / HF+)',
    vendorId: 0x1d50,
    productId: 0x60a1,
    deviceType: 'airspy',
  },
];

export function findDeviceByUsb(device: USBDevice): DeviceEntry | undefined {
  return deviceCatalog.find(
    (e) => e.vendorId === device.vendorId && e.productId === device.productId
  );
}
