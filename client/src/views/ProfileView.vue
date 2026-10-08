<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { updatePassword, updateProfile } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const profileRef = ref<FormInstance>()
const pwdRef = ref<FormInstance>()
const savingProfile = ref(false)
const savingPwd = ref(false)

const profileForm = reactive({
  nickname: '',
  avatar: '',
  phone: '',
})

const pwdForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const profileRules: FormRules = {
  nickname: [{ max: 30, message: '昵称最多 30 字', trigger: 'blur' }],
  avatar: [{ type: 'url', message: '头像必须是合法 URL', trigger: 'blur' }],
  phone: [{ pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确', trigger: 'blur' }],
}

const pwdRules: FormRules = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '新密码至少 8 位', trigger: 'blur' },
    { pattern: /^(?=.*[a-zA-Z])(?=.*\d)/, message: '需同时包含字母和数字', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_rule, value: string, callback) => {
        if (value !== pwdForm.newPassword) {
          callback(new Error('两次密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
}

// 进入页面拉取最新用户信息并回填表单
onMounted(async () => {
  await authStore.fetchMe()
  const u = authStore.user
  if (u) {
    profileForm.nickname = u.nickname ?? ''
    profileForm.avatar = u.avatar ?? ''
    profileForm.phone = u.phone ?? ''
  }
})

const saveProfile = async (): Promise<void> => {
  if (!profileRef.value) return
  const valid = await profileRef.value.validate().then(() => true).catch(() => false)
  if (!valid) return

  savingProfile.value = true
  try {
    await updateProfile({
      nickname: profileForm.nickname || null,
      avatar: profileForm.avatar || null,
      phone: profileForm.phone || null,
    })
    await authStore.fetchMe()
    ElMessage.success('资料已更新')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '更新失败')
  } finally {
    savingProfile.value = false
  }
}

const savePassword = async (): Promise<void> => {
  if (!pwdRef.value) return
  const valid = await pwdRef.value.validate().then(() => true).catch(() => false)
  if (!valid) return

  savingPwd.value = true
  try {
    await updatePassword({ oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword })
    ElMessage.success('密码已修改，请重新登录')
    authStore.logout()
    router.push('/login')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '修改失败')
  } finally {
    savingPwd.value = false
  }
}

const handleLogout = (): void => {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="profile-page">
    <el-row :gutter="16">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>
            <span>基本资料</span>
          </template>

          <el-descriptions v-if="authStore.user" :column="1" border>
            <el-descriptions-item label="用户名">{{ authStore.user.username }}</el-descriptions-item>
            <el-descriptions-item label="邮箱">{{ authStore.user.email }}</el-descriptions-item>
            <el-descriptions-item label="角色">
              <el-tag :type="authStore.user.role === 'SELLER' ? 'warning' : 'info'">
                {{ authStore.user.role === 'SELLER' ? '卖家' : authStore.user.role === 'ADMIN' ? '管理员' : '普通用户' }}
              </el-tag>
            </el-descriptions-item>
          </el-descriptions>

          <el-divider />

          <el-form ref="profileRef" :model="profileForm" :rules="profileRules" label-width="80px">
            <el-form-item label="昵称" prop="nickname">
              <el-input v-model="profileForm.nickname" placeholder="昵称" />
            </el-form-item>
            <el-form-item label="手机号" prop="phone">
              <el-input v-model="profileForm.phone" placeholder="手机号（选填）" />
            </el-form-item>
            <el-form-item label="头像 URL" prop="avatar">
              <el-input v-model="profileForm.avatar" placeholder="头像图片链接（选填）" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingProfile" @click="saveProfile">保存资料</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card shadow="never">
          <template #header>
            <span>修改密码</span>
          </template>

          <el-form ref="pwdRef" :model="pwdForm" :rules="pwdRules" label-width="80px">
            <el-form-item label="原密码" prop="oldPassword">
              <el-input v-model="pwdForm.oldPassword" type="password" show-password />
            </el-form-item>
            <el-form-item label="新密码" prop="newPassword">
              <el-input v-model="pwdForm.newPassword" type="password" show-password />
            </el-form-item>
            <el-form-item label="确认新密码" prop="confirmPassword">
              <el-input v-model="pwdForm.confirmPassword" type="password" show-password />
            </el-form-item>
            <el-form-item>
              <el-button type="danger" :loading="savingPwd" @click="savePassword">修改密码</el-button>
            </el-form-item>
          </el-form>

          <el-divider />

          <el-button text type="danger" @click="handleLogout">退出登录</el-button>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.profile-page {
  max-width: 1100px;
  margin: 0 auto;
}
</style>
