import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    meta: { title: '首页' },
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { title: '数据看板', requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/products/:id',
    name: 'product-detail',
    component: () => import('@/views/ProductDetailView.vue'),
    meta: { title: '商品详情' },
  },
  {
    path: '/publish',
    name: 'product-publish',
    component: () => import('@/views/ProductFormView.vue'),
    meta: { title: '发布商品', requiresAuth: true },
  },
  {
    path: '/products/:id/edit',
    name: 'product-edit',
    component: () => import('@/views/ProductFormView.vue'),
    meta: { title: '编辑商品', requiresAuth: true },
  },
  {
    path: '/my-products',
    name: 'my-products',
    component: () => import('@/views/MyProductsView.vue'),
    meta: { title: '我的商品', requiresAuth: true },
  },
  {
    path: '/cart',
    name: 'cart',
    component: () => import('@/views/CartView.vue'),
    meta: { title: '购物车', requiresAuth: true },
  },
  {
    path: '/orders',
    name: 'orders',
    component: () => import('@/views/OrderListView.vue'),
    meta: { title: '我的订单', requiresAuth: true },
  },
  {
    path: '/orders/:id',
    name: 'order-detail',
    component: () => import('@/views/OrderDetailView.vue'),
    meta: { title: '订单详情', requiresAuth: true },
  },
  {
    path: '/admin/products',
    name: 'admin-products',
    component: () => import('@/views/AdminProductReviewView.vue'),
    meta: { title: '商品审核', requiresAuth: true },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录' },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { title: '注册' },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/views/ProfileView.vue'),
    meta: { title: '个人中心', requiresAuth: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: '页面不存在' },
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

// 路由守卫：只读 localStorage 判断登录态，避免与 store 产生循环依赖
router.beforeEach((to) => {
  const token = localStorage.getItem('token')

  // 需登录页面未登录 → 跳登录页并记住来源
  if (to.meta.requiresAuth && !token) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  // 仅管理员可访问的页面：非管理员直接回首页，
  // 避免先渲染页面再被接口的 403 踢回来（DashboardView 里仍保留了兜底处理）
  if (to.meta.requiresAdmin) {
    let role: string | null = null
    try {
      const raw = localStorage.getItem('user')
      role = raw ? ((JSON.parse(raw) as { role?: string }).role ?? null) : null
    } catch {
      role = null
    }
    if (role !== 'ADMIN') {
      return { path: '/' }
    }
  }

  // 已登录访问登录 / 注册页 → 回首页
  if ((to.path === '/login' || to.path === '/register') && token) {
    return { path: '/' }
  }
})

router.afterEach((to) => {
  const title = to.meta.title
  document.title = typeof title === 'string' ? `${title} · 智能二手交易平台` : '智能二手交易平台'
})

export default router
