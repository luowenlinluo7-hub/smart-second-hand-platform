<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules, type UploadFile } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { updatePassword, updateProfile } from '@/api/auth'
import { uploadImages } from '@/api/product'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const profileRef = ref<FormInstance>()
const pwdRef = ref<FormInstance>()
const savingProfile = ref(false)
const savingPwd = ref(false)
const uploadingAvatar = ref(false)

const profileForm = reactive({
  nickname: '',
  avatar: '',
  phone: '',
})

// 上传前校验：仅图片、≤5MB（与后端 multer 限制保持一致）
const beforeAvatarUpload = (file: File): boolean => {
  const isImage = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)
  if (!isImage) {
    ElMessage.error('头像仅支持 jpg / png / webp / gif')
    return false
  }
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.error('头像大小不能超过 5MB')
    return false
  }
  return true
}

// 手动上传：走统一的 http 封装（自动带 token、统一拆包）
const onAvatarChange = async (file: UploadFile): Promise<void> => {
  if (!file.raw) return
  // auto-upload 关闭时 before-upload 不触发，这里手动校验
  if (!beforeAvatarUpload(file.raw)) return

  uploadingAvatar.value = true
  try {
    const result = await uploadImages([file.raw])
    const url = result.urls[0]
    if (!url) {
      ElMessage.error('头像上传失败')
      return
    }
    profileForm.avatar = url
    ElMessage.success('头像已上传，记得点击「保存资料」')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '头像上传失败')
  } finally {
    uploadingAvatar.value = false
  }
}

const pwdForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const profileRules: FormRules = {
  nickname: [{ max: 30, message: '昵称最多 30 字', trigger: 'blur' }],
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
            <el-form-item label="头像" prop="avatar">
              <div class="avatar-upload">
                <el-upload
                  :show-file-list="false"
                  :auto-upload="false"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  :on-change="onAvatarChange"
                >
                  <div v-loading="uploadingAvatar" class="avatar-box">
                    <img v-if="profileForm.avatar" :src="profileForm.avatar" class="avatar-img" alt="头像" />
                    <el-icon v-else class="avatar-plus"><Plus /></el-icon>
                  </div>
                </el-upload>
                <div class="avatar-tip">
                  点击上传头像，支持 jpg / png / webp / gif，≤5MB
                  <el-button
                    v-if="profileForm.avatar"
                    text
                    type="danger"
                    size="small"
                    @click="profileForm.avatar = ''"
                  >
                    移除
                  </el-button>
                </div>
              </div>
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

.avatar-upload {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar-box {
  width: 88px;
  height: 88px;
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.2s;
}

.avatar-box:hover {
  border-color: var(--el-color-primary);
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-plus {
  font-size: 24px;
  color: #8c939d;
}

.avatar-tip {
  font-size: 12px;
  color: #909399;
}
</style>
