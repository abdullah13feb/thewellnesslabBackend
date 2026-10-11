
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const GOWA_API_URL = process.env.CTWA_GOWA_API_URL || 'http://3.110.175.249:3000';
const DEVICE_ID = 'UrbanSauna';
const AUTH = {
  username: process.env.GOWA_BASIC_USER || 'user1',
  password: process.env.GOWA_BASIC_PASS || 'pass1',
};

async function inspectGOWAEndpoints() {
  console.log('🔍 Testing GOWA endpoints on:', GOWA_API_URL);

  const testEndpoints = [
    { method: 'get', path: '/chats?phone=919625534956' },
    { method: 'get', path: '/chats?jid=919625534956@s.whatsapp.net' },
    { method: 'get', path: '/chats/919625534956' },
    { method: 'get', path: '/user/my/chats' },
    { method: 'get', path: '/user/my/messages' },
    { method: 'get', path: '/devices/UrbanSauna' },
    { method: 'get', path: '/devices/UrbanSauna/chats' },
    { method: 'get', path: '/devices/UrbanSauna/messages' },
  ];

  for (const ep of testEndpoints) {
    try {
      const res = await axios({
        method: ep.method as any,
        url: `${GOWA_API_URL}${ep.path}`,
        headers: { 'X-Device-Id': DEVICE_ID },
        auth: AUTH,
        timeout: 4000,
      });

      console.log(`✅ SUCCESS [${ep.method.toUpperCase()} ${ep.path}] -> Status: ${res.status}`);
      const dataStr = JSON.stringify(res.data);
      console.log(`   Sample Data: ${dataStr.slice(0, 200)}...`);
    } catch (err: any) {
      console.log(`❌ FAILED [${ep.method.toUpperCase()} ${ep.path}] -> Status: ${err.response?.status || err.message}`);
    }
  }
}

inspectGOWAEndpoints();
