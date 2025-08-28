// Logseq MCP Bridge Service - 配置管理界面

class MCPBridgeUI {
    constructor() {
        this.baseUrl = window.location.origin;
        this.apiUrl = `${this.baseUrl}/api`;
        this.refreshInterval = null;
        this.init();
    }

    // 加载任务状态
    async loadTasks() {
        const loadingEl = document.getElementById('tasks-loading');
        const errorEl = document.getElementById('tasks-error');
        const contentEl = document.getElementById('tasks-content');
        
        try {
            loadingEl.style.display = 'block';
            errorEl.style.display = 'none';
            contentEl.style.display = 'none';
            
            const response = await fetch(`${this.apiUrl}/tasks`);
            const data = await response.json();
            
            if (response.ok && data.success) {
                this.renderTasks(data.tasks, data.summary);
                loadingEl.style.display = 'none';
                contentEl.style.display = 'block';
            } else {
                throw new Error(data.error || '加载任务状态失败');
            }
        } catch (error) {
            console.error('加载任务状态失败:', error);
            errorEl.textContent = `加载任务状态失败: ${error.message}`;
            loadingEl.style.display = 'none';
            errorEl.style.display = 'block';
        }
    }

    // 渲染任务列表
    renderTasks(tasks, summary) {
        // 更新统计信息
        document.getElementById('total-tasks').textContent = summary.total;
        document.getElementById('processing-tasks').textContent = summary.pending + summary.processing;
        document.getElementById('completed-tasks').textContent = summary.completed;
        document.getElementById('failed-tasks').textContent = summary.failed;
        
        // 渲染任务列表
        const tasksListEl = document.getElementById('tasks-list');
        
        if (tasks.length === 0) {
            tasksListEl.innerHTML = '<div class="loading">暂无任务记录</div>';
            return;
        }
        
        const tasksHtml = tasks.map(task => {
            const statusClass = this.getTaskStatusClass(task.status);
            const statusText = this.getTaskStatusText(task.status);
            const duration = task.duration ? this.formatDuration(task.duration) : '-';
            const createdAt = new Date(task.createdAt).toLocaleString('zh-CN');
            
            return `
                <div class="service-item">
                    <div class="service-header">
                        <div class="service-name">
                            ${this.escapeHtml(task.id)}
                            <small style="color: #7f8c8d; font-weight: normal;"> (${task.type || 'unknown'})</small>
                        </div>
                        <div class="service-status ${statusClass}">${statusText}</div>
                    </div>
                    <div class="service-description">
                        <strong>创建时间:</strong> ${createdAt}<br>
                        <strong>执行时长:</strong> ${duration}<br>
                        ${task.filename ? `<strong>文件名:</strong> ${this.escapeHtml(task.filename)}<br>` : ''}
                        ${task.filePath ? `<strong>文件路径:</strong> ${this.escapeHtml(task.filePath)}<br>` : ''}
                        ${task.error ? `<strong>错误信息:</strong> <span style="color: #e74c3c;">${this.escapeHtml(task.error)}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        tasksListEl.innerHTML = tasksHtml;
    }

    // 获取任务状态样式类
    getTaskStatusClass(status) {
        switch (status) {
            case 'completed': return 'status-connected';
            case 'failed': return 'status-disconnected';
            case 'pending':
            case 'processing': return 'status-disabled';
            default: return 'status-disabled';
        }
    }

    // 获取任务状态文本
    getTaskStatusText(status) {
        switch (status) {
            case 'pending': return '等待中';
            case 'processing': return '处理中';
            case 'completed': return '已完成';
            case 'failed': return '失败';
            default: return '未知';
        }
    }

    // 格式化持续时间
    formatDuration(ms) {
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
        return `${(ms / 3600000).toFixed(1)}h`;
    }

    async init() {
        await this.loadServerStatus();
        await this.loadServices();
        await this.loadTools();
        await this.loadApiConfig();
        this.startAutoRefresh();
        this.setupEventListeners();
    }

    setupEventListeners() {
        // 添加服务表单提交
        document.getElementById('add-service-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addService();
        });

        // 模态框外部点击关闭
        document.getElementById('add-service-modal').addEventListener('click', (e) => {
            if (e.target.id === 'add-service-modal') {
                this.hideAddServiceModal();
            }
        });
    }

    async loadServerStatus() {
        try {
            const response = await fetch(`${this.apiUrl}/health`);
            const data = await response.json();
            
            if (response.ok) {
                document.getElementById('server-status').textContent = '在线';
                document.getElementById('server-status').className = 'status-value status-online';
                document.getElementById('uptime').textContent = this.formatUptime(data.uptime);
            } else {
                throw new Error('服务器响应错误');
            }
        } catch (error) {
            document.getElementById('server-status').textContent = '离线';
            document.getElementById('server-status').className = 'status-value status-offline';
            console.error('加载服务器状态失败:', error);
        }
    }

    async loadServices() {
        const loadingEl = document.getElementById('services-loading');
        const errorEl = document.getElementById('services-error');
        const listEl = document.getElementById('services-list');
        
        try {
            loadingEl.style.display = 'block';
            errorEl.style.display = 'none';
            
            const response = await fetch(`${this.apiUrl}/services`);
            const data = await response.json();
            
            if (response.ok) {
                this.renderServices(data.services);
                this.updateConnectedCount(data.services);
            } else {
                throw new Error(data.error || '加载服务失败');
            }
        } catch (error) {
            errorEl.textContent = `加载服务失败: ${error.message}`;
            errorEl.style.display = 'block';
            listEl.innerHTML = '';
        } finally {
            loadingEl.style.display = 'none';
        }
    }

    async loadTools() {
        const loadingEl = document.getElementById('tools-loading');
        const errorEl = document.getElementById('tools-error');
        const listEl = document.getElementById('tools-list');
        
        try {
            loadingEl.style.display = 'block';
            errorEl.style.display = 'none';
            
            const response = await fetch(`${this.apiUrl}/tools`);
            const data = await response.json();
            
            if (response.ok) {
                this.renderTools(data.tools);
                document.getElementById('tools-count').textContent = data.tools.length;
            } else {
                throw new Error(data.error || '加载工具失败');
            }
        } catch (error) {
            errorEl.textContent = `加载工具失败: ${error.message}`;
            errorEl.style.display = 'block';
            listEl.innerHTML = '';
        } finally {
            loadingEl.style.display = 'none';
        }
    }

    renderServices(services) {
        const listEl = document.getElementById('services-list');
        
        if (services.length === 0) {
            listEl.innerHTML = '<div class="loading">暂无配置的服务</div>';
            return;
        }
        
        listEl.innerHTML = services.map(service => `
            <div class="service-item">
                <div class="service-header">
                    <div class="service-name">${this.escapeHtml(service.name)}</div>
                    <div class="service-status ${this.getStatusClass(service.status)}">
                        ${this.getStatusText(service.status)}
                    </div>
                </div>
                <div class="service-description">
                    ${this.escapeHtml(service.description || '无描述')}
                </div>
                <div style="font-size: 0.8em; color: #7f8c8d; margin-bottom: 10px;">
                    类型: ${service.type} | 工具: ${service.toolsCount} | 资源: ${service.resourcesCount}
                    ${service.connectedAt ? `| 连接时间: ${new Date(service.connectedAt).toLocaleString()}` : ''}
                </div>
                ${service.lastError ? `
                    <div style="background: #fadbd8; color: #e74c3c; padding: 8px; border-radius: 4px; font-size: 0.8em; margin-bottom: 10px;">
                        错误: ${this.escapeHtml(service.lastError)}
                    </div>
                ` : ''}
                <div class="service-actions">
                    ${service.status === 'connected' ? 
                        `<button class="btn btn-danger" onclick="ui.disconnectService('${service.id}')">断开连接</button>` :
                        `<button class="btn btn-success" onclick="ui.connectService('${service.id}')">连接</button>`
                    }
                    <button class="btn btn-primary" onclick="ui.viewServiceDetails('${service.id}')">详情</button>
                    <button class="btn btn-secondary" onclick="ui.editService('${service.id}')">编辑</button>
                    <button class="btn btn-danger" onclick="ui.removeService('${service.id}')">删除</button>
                </div>
            </div>
        `).join('');
    }

    renderTools(tools) {
        const listEl = document.getElementById('tools-list');
        
        if (tools.length === 0) {
            listEl.innerHTML = '<div class="loading">暂无可用工具</div>';
            return;
        }
        
        listEl.innerHTML = tools.map(tool => `
            <div class="service-item">
                <div class="service-header">
                    <div class="service-name">${this.escapeHtml(tool.name)}</div>
                    <div style="font-size: 0.8em; color: #7f8c8d;">
                        来自: ${tool.serviceId}
                    </div>
                </div>
                <div class="service-description">
                    ${this.escapeHtml(tool.description || '无描述')}
                </div>
                ${tool.logseqCommand ? `
                    <div style="background: #e8f4fd; color: #3498db; padding: 8px; border-radius: 4px; font-size: 0.8em; margin-bottom: 10px;">
                        Logseq 命令: ${this.escapeHtml(tool.logseqCommand)}
                    </div>
                ` : ''}
                <div class="service-actions">
                    <button class="btn btn-primary" onclick="ui.testTool('${tool.serviceId}', '${tool.name}')">测试工具</button>
                    <button class="btn btn-secondary" onclick="ui.viewToolSchema('${tool.serviceId}', '${tool.name}')">查看参数</button>
                </div>
            </div>
        `).join('');
    }

    async connectService(serviceId) {
        try {
            const response = await fetch(`${this.apiUrl}/services/${serviceId}/connect`, {
                method: 'POST'
            });
            const data = await response.json();
            
            if (response.ok) {
                this.showMessage('服务连接请求已发送', 'success');
                setTimeout(() => this.loadServices(), 1000);
            } else {
                throw new Error(data.error || '连接失败');
            }
        } catch (error) {
            this.showMessage(`连接服务失败: ${error.message}`, 'error');
        }
    }

    async disconnectService(serviceId) {
        try {
            const response = await fetch(`${this.apiUrl}/services/${serviceId}/disconnect`, {
                method: 'POST'
            });
            const data = await response.json();
            
            if (response.ok) {
                this.showMessage('服务已断开连接', 'success');
                setTimeout(() => this.loadServices(), 1000);
            } else {
                throw new Error(data.error || '断开连接失败');
            }
        } catch (error) {
            this.showMessage(`断开连接失败: ${error.message}`, 'error');
        }
    }

    async removeService(serviceId) {
        if (!confirm('确定要删除这个服务吗？此操作不可撤销。')) {
            return;
        }
        
        try {
            const response = await fetch(`${this.apiUrl}/config/services/${serviceId}`, {
                method: 'DELETE'
            });
            const data = await response.json();
            
            if (response.ok) {
                this.showMessage('服务已删除', 'success');
                this.loadServices();
                this.loadTools();
            } else {
                throw new Error(data.error || '删除失败');
            }
        } catch (error) {
            this.showMessage(`删除服务失败: ${error.message}`, 'error');
        }
    }

    async addService() {
        const form = document.getElementById('add-service-form');
        const formData = new FormData(form);
        
        try {
            const serviceConfig = {
                id: formData.get('id'),
                name: formData.get('name'),
                description: formData.get('description'),
                type: formData.get('type'),
                enabled: formData.has('enabled')
            };
            
            // 根据类型添加特定配置
            if (serviceConfig.type === 'stdio') {
                serviceConfig.command = formData.get('command');
                const argsText = formData.get('args');
                if (argsText) {
                    serviceConfig.args = argsText.split('\n').filter(arg => arg.trim());
                }
                const envText = formData.get('env');
                if (envText) {
                    serviceConfig.env = JSON.parse(envText);
                }
            } else {
                serviceConfig.url = formData.get('url');
                const headersText = formData.get('headers');
                if (headersText) {
                    serviceConfig.headers = JSON.parse(headersText);
                }
            }
            
            const response = await fetch(`${this.apiUrl}/config/services`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(serviceConfig)
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.showMessage('服务添加成功', 'success');
                this.hideAddServiceModal();
                form.reset();
                this.loadServices();
                this.loadTools();
            } else {
                throw new Error(data.error || '添加失败');
            }
        } catch (error) {
            this.showMessage(`添加服务失败: ${error.message}`, 'error');
        }
    }

    showAddServiceModal() {
        document.getElementById('add-service-modal').style.display = 'block';
    }

    hideAddServiceModal() {
        document.getElementById('add-service-modal').style.display = 'none';
    }

    toggleConnectionFields() {
        const type = document.querySelector('select[name="type"]').value;
        const stdioConfig = document.getElementById('stdio-config');
        const urlConfig = document.getElementById('url-config');
        
        if (type === 'stdio') {
            stdioConfig.style.display = 'block';
            urlConfig.style.display = 'none';
        } else {
            stdioConfig.style.display = 'none';
            urlConfig.style.display = 'block';
        }
    }

    async viewServiceDetails(serviceId) {
        try {
            const response = await fetch(`${this.apiUrl}/services/${serviceId}`);
            const data = await response.json();
            
            if (response.ok) {
                alert(`服务详情:\n\n${JSON.stringify(data, null, 2)}`);
            } else {
                throw new Error(data.error || '获取详情失败');
            }
        } catch (error) {
            this.showMessage(`获取服务详情失败: ${error.message}`, 'error');
        }
    }

    editService(serviceId) {
        this.showMessage('编辑功能开发中...', 'info');
    }

    testTool(serviceId, toolName) {
        const args = prompt(`请输入 ${toolName} 工具的参数 (JSON 格式):`, '{}');
        if (args === null) return;
        
        try {
            const toolArgs = JSON.parse(args);
            this.callTool(serviceId, toolName, toolArgs);
        } catch (error) {
            this.showMessage('参数格式错误，请输入有效的 JSON', 'error');
        }
    }

    async callTool(serviceId, toolName, toolArgs) {
        try {
            const response = await fetch(`${this.apiUrl}/tools/${serviceId}/${toolName}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ arguments: toolArgs })
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
                alert(`工具调用成功:\n\n${JSON.stringify(data.result, null, 2)}`);
            } else {
                throw new Error(data.error || '工具调用失败');
            }
        } catch (error) {
            this.showMessage(`工具调用失败: ${error.message}`, 'error');
        }
    }

    viewToolSchema(serviceId, toolName) {
        // 这里可以显示工具的输入参数模式
        this.showMessage('参数模式查看功能开发中...', 'info');
    }

    updateConnectedCount(services) {
        const connectedCount = services.filter(s => s.status === 'connected').length;
        document.getElementById('connected-count').textContent = connectedCount;
    }

    getStatusClass(status) {
        switch (status) {
            case 'connected': return 'status-connected';
            case 'disconnected': return 'status-disconnected';
            default: return 'status-disabled';
        }
    }

    getStatusText(status) {
        switch (status) {
            case 'connected': return '已连接';
            case 'disconnected': return '已断开';
            case 'connecting': return '连接中';
            case 'error': return '错误';
            default: return '未知';
        }
    }

    formatUptime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showMessage(message, type = 'info') {
        // 创建消息元素
        const messageEl = document.createElement('div');
        messageEl.className = type;
        messageEl.textContent = message;
        messageEl.style.position = 'fixed';
        messageEl.style.top = '20px';
        messageEl.style.right = '20px';
        messageEl.style.zIndex = '9999';
        messageEl.style.padding = '15px 20px';
        messageEl.style.borderRadius = '6px';
        messageEl.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
        
        document.body.appendChild(messageEl);
        
        // 3秒后自动移除
        setTimeout(() => {
            if (messageEl.parentNode) {
                messageEl.parentNode.removeChild(messageEl);
            }
        }, 3000);
    }

    startAutoRefresh() {
        // 每30秒刷新一次状态
        this.refreshInterval = setInterval(() => {
            this.loadServerStatus();
            this.loadServices();
            this.loadTools();
        }, 30000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    // 标签页切换
    showTab(tabName) {
        // 隐藏所有标签页内容
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        
        // 移除所有标签按钮的激活状态
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        
        // 显示选中的标签页
        const targetTab = document.getElementById(`${tabName}-tab`);
        if (targetTab) {
            targetTab.classList.add('active');
        }
        
        // 激活对应的标签按钮
        const targetButton = document.querySelector(`[onclick="showTab('${tabName}')"]`);
        if (targetButton) {
            targetButton.classList.add('active');
        }
        
        // 如果切换到配置页面，加载配置
        if (tabName === 'config') {
            this.loadApiConfig();
        }
        
        // 如果切换到任务状态页面，加载任务状态
        if (tabName === 'tasks') {
            this.loadTasks();
        }
    }

    // 加载API配置
    async loadApiConfig() {
        const loadingEl = document.getElementById('config-loading');
        const errorEl = document.getElementById('config-error');
        const formEl = document.getElementById('config-form');
        
        try {
            loadingEl.style.display = 'block';
            errorEl.style.display = 'none';
            formEl.style.display = 'none';
            
            const response = await fetch(`${this.apiUrl}/api-config`);
            const data = await response.json();
            
            if (response.ok) {
                this.populateConfigForm(data.config || {});
                formEl.style.display = 'block';
            } else {
                throw new Error(data.error || '加载配置失败');
            }
        } catch (error) {
            errorEl.textContent = `加载配置失败: ${error.message}`;
            errorEl.style.display = 'block';
        } finally {
            loadingEl.style.display = 'none';
        }
    }

    // 填充配置表单
    populateConfigForm(config) {
        // 图像API配置
        const imageApiAddress = document.getElementById('image-api-address');
        const imageApiKey = document.getElementById('image-api-key');
        if (imageApiAddress) imageApiAddress.value = config.imageApiAddress || '';
        if (imageApiKey) {
            imageApiKey.value = config.imageApiKey || '';
            this.setupApiKeyInput(imageApiKey, config.imageApiKey);
        }
        
        // 图像模型配置
        const imageModel = document.getElementById('image-model');
        const imageEditModel = document.getElementById('image-edit-model');
        const imageEditQuality = document.getElementById('image-edit-quality');
        const imageEditResponseFormat = document.getElementById('image-edit-response-format');
        const imageEditSize = document.getElementById('image-edit-size');
        const imageEditCount = document.getElementById('image-edit-count');
        if (imageModel) imageModel.value = config.imageModel || 'qwen-image';
        if (imageEditModel) imageEditModel.value = config.imageEditModel || 'qwen-image-edit';
        if (imageEditQuality) imageEditQuality.value = config.imageEditQuality || 'auto';
        if (imageEditResponseFormat) imageEditResponseFormat.value = config.imageEditResponseFormat || 'b64_json';
        if (imageEditSize) imageEditSize.value = config.imageEditSize || 'auto';
        if (imageEditCount) imageEditCount.value = config.imageEditCount || '1';
        
        // TTS API配置
        const ttsApiAddress = document.getElementById('tts-api-address');
        const ttsApiKey = document.getElementById('tts-api-key');
        if (ttsApiAddress) ttsApiAddress.value = config.ttsApiAddress || '';
        if (ttsApiKey) {
            ttsApiKey.value = config.ttsApiKey || '';
            this.setupApiKeyInput(ttsApiKey, config.ttsApiKey);
        }
        
        // TTS模型配置
        const ttsModel = document.getElementById('tts-model');
        const ttsVoice = document.getElementById('tts-voice');
        const ttsResponseFormat = document.getElementById('tts-response-format');
        const ttsSpeed = document.getElementById('tts-speed');
        if (ttsModel) ttsModel.value = config.ttsModel || 'tts-1';
        if (ttsVoice) ttsVoice.value = config.ttsVoice || 'alloy';
        if (ttsResponseFormat) ttsResponseFormat.value = config.ttsResponseFormat || 'mp3';
        if (ttsSpeed) ttsSpeed.value = config.ttsSpeed || '1.0';
        
        // 千问TTS配置
        const qwenTtsModel = document.getElementById('qwen-tts-model');
        const qwenTtsVoice = document.getElementById('qwen-tts-voice');
        const qwenTtsFormat = document.getElementById('qwen-tts-format');
        if (qwenTtsModel) qwenTtsModel.value = config.qwenTtsModel || 'cosyvoice-v1';
        if (qwenTtsVoice) qwenTtsVoice.value = config.qwenTtsVoice || 'longwan';
        if (qwenTtsFormat) qwenTtsFormat.value = config.qwenTtsFormat || 'mp3';
        
        // DashScope API配置
        const dashscopeApiKey = document.getElementById('dashscope-api-key');
        if (dashscopeApiKey) {
            dashscopeApiKey.value = config.dashscopeApiKey || '';
            this.setupApiKeyInput(dashscopeApiKey, config.dashscopeApiKey);
        }
        
        // 其他配置
        const logLevel = document.getElementById('log-level');
        const requestTimeout = document.getElementById('request-timeout');
        if (logLevel) logLevel.value = config.logLevel || 'info';
        if (requestTimeout) requestTimeout.value = config.requestTimeout || 30;
    }

    // 设置API Key输入框的用户体验
    setupApiKeyInput(inputElement, apiKeyValue) {
        if (!inputElement) return;
        
        const isMasked = this.isMaskedApiKey(apiKeyValue);
        
        if (isMasked) {
            // 如果是掩码值，设置placeholder提示
            inputElement.placeholder = '当前显示为掩码，输入新的API Key或保持不变';
            inputElement.style.color = '#999';
            
            // 添加focus事件监听器，当用户开始输入时清除掩码
            const onFocus = () => {
                if (this.isMaskedApiKey(inputElement.value)) {
                    inputElement.value = '';
                    inputElement.style.color = '';
                    inputElement.placeholder = '请输入API Key';
                }
                inputElement.removeEventListener('focus', onFocus);
            };
            
            inputElement.addEventListener('focus', onFocus);
        } else {
            inputElement.placeholder = '请输入API Key';
            inputElement.style.color = '';
        }
    }

    // 检查是否为掩码的API key
    isMaskedApiKey(value) {
        if (!value) return false;
        // 检查是否为掩码格式：***xxxx 或 ****xxxx
        return /^\*{3,}[a-zA-Z0-9]{4}$/.test(value);
    }

    // 保存API配置
    async saveApiConfig() {
        const errorEl = document.getElementById('config-error');
        const successEl = document.getElementById('config-success');
        
        try {
            errorEl.style.display = 'none';
            successEl.style.display = 'none';
            
            const config = {
                imageApiAddress: document.getElementById('image-api-address').value.trim(),
                imageModel: document.getElementById('image-model').value,
                imageEditModel: document.getElementById('image-edit-model').value,
                imageEditQuality: document.getElementById('image-edit-quality').value,
                imageEditResponseFormat: document.getElementById('image-edit-response-format').value,
                imageEditSize: document.getElementById('image-edit-size').value,
                imageEditCount: document.getElementById('image-edit-count').value,
                ttsApiAddress: document.getElementById('tts-api-address').value.trim(),
                ttsModel: document.getElementById('tts-model').value,
                ttsVoice: document.getElementById('tts-voice').value,
                ttsResponseFormat: document.getElementById('tts-response-format').value,
                ttsSpeed: document.getElementById('tts-speed').value,
                qwenTtsModel: document.getElementById('qwen-tts-model').value,
                qwenTtsVoice: document.getElementById('qwen-tts-voice').value,
                qwenTtsFormat: document.getElementById('qwen-tts-format').value,
                logLevel: document.getElementById('log-level').value,
                requestTimeout: parseInt(document.getElementById('request-timeout').value) || 30
            };
            
            // 只有当API key不是掩码时才包含在配置中
            const imageApiKey = document.getElementById('image-api-key').value.trim();
            if (imageApiKey && !this.isMaskedApiKey(imageApiKey)) {
                config.imageApiKey = imageApiKey;
            }
            
            const ttsApiKey = document.getElementById('tts-api-key').value.trim();
            if (ttsApiKey && !this.isMaskedApiKey(ttsApiKey)) {
                config.ttsApiKey = ttsApiKey;
            }
            
            const dashscopeApiKey = document.getElementById('dashscope-api-key').value.trim();
            if (dashscopeApiKey && !this.isMaskedApiKey(dashscopeApiKey)) {
                config.dashscopeApiKey = dashscopeApiKey;
            }
            
            const response = await fetch(`${this.apiUrl}/api-config`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ config })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                successEl.textContent = '配置保存成功！服务将在下次重启时生效。';
                successEl.style.display = 'block';
                
                // 3秒后隐藏成功消息
                setTimeout(() => {
                    successEl.style.display = 'none';
                }, 3000);
            } else {
                throw new Error(data.error || '保存配置失败');
            }
        } catch (error) {
            errorEl.textContent = `保存配置失败: ${error.message}`;
            errorEl.style.display = 'block';
        }
    }
}

// 创建全局实例
const ui = new MCPBridgeUI();

// 全局函数供HTML调用
function refreshTasks() {
    ui.loadTasks();
}

// 全局函数（供 HTML 调用）
window.showAddServiceModal = () => ui.showAddServiceModal();
window.hideAddServiceModal = () => ui.hideAddServiceModal();
window.toggleConnectionFields = () => ui.toggleConnectionFields();
window.showTab = (tabName) => ui.showTab(tabName);
window.saveApiConfig = () => ui.saveApiConfig();

// 页面卸载时停止自动刷新
window.addEventListener('beforeunload', () => {
    ui.stopAutoRefresh();
});