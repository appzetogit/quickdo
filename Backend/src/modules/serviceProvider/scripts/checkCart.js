const axios = require('axios');

async function testCart() {
  const API_URL = 'http://localhost:5000/api';
  const phone = '9876543210';

  try {
    // 1. Send OTP
    console.log('Sending OTP...');
    const otpRes = await axios.post(`${API_URL}/users/auth/send-otp`, { phone });
    console.log('OTP Sent:', otpRes.data);
    const otpToken = otpRes.data.token;

    // 2. Login (Assuming OTP is 123456 for test or extracting from logs if real)
    // For test env usually specific OTP is hardcoded or we just simulate
    console.log('Logging in...');
    const loginRes = await axios.post(`${API_URL}/users/auth/login`, {
      phone,
      otp: '123456',
      token: otpToken
    });
    console.log('Login Success:', loginRes.data.success);
    const token = loginRes.data.accessToken;

    // 3. Add to Cart
    console.log('Adding to cart...');
    const cartItem = {
      title: "Test Service",
      category: "Test Category",
      price: 100,
      unitPrice: 100,
      serviceCount: 1,
      description: "Test Description",
      icon: "test-icon.png"
    };

    const cartRes = await axios.post(
      `${API_URL}/users/cart`,
      cartItem,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log('Add to Cart Result:', cartRes.data);

    // 4. Get Cart
    console.log('Fetching cart...');
    const getCartRes = await axios.get(
      `${API_URL}/users/cart`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log('Cart Items:', getCartRes.data.data.length);

  } catch (error) {
    console.error('Test Failed:', error.response ? error.response.data : error.message);
  }
}

testCart();
