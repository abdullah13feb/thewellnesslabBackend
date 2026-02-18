# Radiant Aura Labs - Backend API

Express.js backend API for managing products, cart, and orders.

## Setup

```bash
cd server
npm install  # or bun install
```

## Running the Server

**Development (with hot reload):**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

Server will run on `http://localhost:5000`

## API Endpoints

### Products
- **GET** `/api/products` - Get all products
- **GET** `/api/products/:id` - Get single product
- **POST** `/api/products` - Create product
- **PUT** `/api/products/:id` - Update product
- **DELETE** `/api/products/:id` - Delete product

### Cart
- **GET** `/api/cart/:userId` - Get user's cart
- **POST** `/api/cart/:userId/items` - Add item to cart
- **PUT** `/api/cart/:userId/items/:productId` - Update item quantity
- **DELETE** `/api/cart/:userId/items/:productId` - Remove item from cart
- **DELETE** `/api/cart/:userId` - Clear entire cart

### Orders
- **GET** `/api/orders` - Get all orders (filter by `?userId=`)
- **GET** `/api/orders/:orderId` - Get single order
- **POST** `/api/orders` - Create order
- **PUT** `/api/orders/:orderId` - Update order status
- **DELETE** `/api/orders/:orderId` - Cancel order
- **GET** `/api/orders/stats/summary` - Get order statistics

## Example Requests

### Create Product
```json
POST /api/products
{
  "name": "Altair Device",
  "price": 299.99,
  "description": "Advanced wellness device",
  "image": "/altair.jpg",
  "category": "devices",
  "stock": 50
}
```

### Add to Cart
```json
POST /api/cart/user123/items
{
  "productId": "1",
  "quantity": 2,
  "price": 299.99
}
```

### Create Order
```json
POST /api/orders
{
  "userId": "user123",
  "items": [
    { "productId": "1", "quantity": 2, "price": 299.99 }
  ],
  "totalPrice": 599.98
}
```

### Update Order Status
```json
PUT /api/orders/order-1234567890
{
  "status": "shipped"
}
```

## Notes
- Currently uses in-memory data storage (resets on server restart)
- For production, replace with a real database (MongoDB, PostgreSQL, etc.)
- CORS is enabled for frontend access
