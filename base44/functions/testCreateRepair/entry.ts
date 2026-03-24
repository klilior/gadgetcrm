import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  const log = [];
  
  try {
    log.push("🔵 Step 1: Getting current user...");
    const user = await base44.auth.me();
    log.push(`✅ User found: ${user.email}, role: ${user.role}, id: ${user.id}`);
    
    log.push("🔵 Step 2: Fetching clients...");
    const clients = await base44.entities.Client.list();
    log.push(`✅ Found ${clients.length} clients`);
    
    if (clients.length === 0) {
      log.push("❌ No clients found, creating test client...");
      const testClient = await base44.entities.Client.create({
        full_name: "Test Client",
        phone: "0501234567"
      });
      log.push(`✅ Test client created: ${testClient.id}`);
      clients.push(testClient);
    }
    
    const client = clients[0];
    log.push(`🔵 Using client: ${client.full_name} (${client.id})`);
    
    log.push("🔵 Step 3: Fetching devices...");
    const devices = await base44.entities.RepairDevice.filter({ client_id: client.id });
    log.push(`✅ Found ${devices.length} devices for this client`);
    
    if (devices.length === 0) {
      log.push("❌ No devices found, creating test device...");
      const testDevice = await base44.entities.RepairDevice.create({
        client_id: client.id,
        manufacturer: "Apple",
        model: "iPhone 13",
        serial_imei: "TEST123456",
        color: "שחור"
      });
      log.push(`✅ Test device created: ${testDevice.id}`);
      devices.push(testDevice);
    }
    
    const device = devices[0];
    log.push(`🔵 Using device: ${device.manufacturer} ${device.model} (${device.id})`);
    
    log.push("🔵 Step 4: Creating repair...");
    
    const now = new Date();
    const repairId = `TEST-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
    
    const repairData = {
      repair_id: repairId,
      client_id: client.id,
      device_id: device.id,
      technician_id: user.id,
      repair_type: 'מעבדת Gadget-Team',
      lock_code: '1234',
      issue_category: 'מסך',
      issue_description: 'מסך שבור - טסט',
      expected_price: 100,
      status: 'בטיפול/אבחון',
      sla_due: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    };
    
    log.push("📋 Repair data prepared:");
    log.push(JSON.stringify(repairData, null, 2));
    
    log.push("🔵 Attempting to create repair...");
    const createdRepair = await base44.entities.Repair.create(repairData);
    log.push(`✅ Repair created successfully!`);
    log.push(`📋 Created repair: ${JSON.stringify(createdRepair, null, 2)}`);
    
    log.push("🔵 Step 5: Verifying repair was saved...");
    const verifyRepair = await base44.entities.Repair.get(createdRepair.id);
    log.push(`✅ Repair verified in database: ${verifyRepair.repair_id}`);
    
    log.push("🔵 Step 6: Listing all repairs...");
    const allRepairs = await base44.entities.Repair.list("-created_date", 10);
    log.push(`✅ Found ${allRepairs.length} repairs in database`);
    
    return new Response(JSON.stringify({
      success: true,
      log: log,
      createdRepairId: createdRepair.id,
      totalRepairs: allRepairs.length
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    log.push(`❌ ERROR: ${error.message}`);
    log.push(`Stack trace: ${error.stack}`);
    
    return new Response(JSON.stringify({
      success: false,
      log: log,
      error: error.message,
      stack: error.stack
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});