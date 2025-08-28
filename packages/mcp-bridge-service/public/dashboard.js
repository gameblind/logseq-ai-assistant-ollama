// Dashboard JavaScript for MCP Bridge Service

class Dashboard {
    constructor() {
        this.baseURL = window.location.origin;
        this.refreshInterval = null;
        this.currentTab = 'services';
        this.init();
    }

    init() {
        this.loadStats();
        this.loadServices();
        this.startAutoRefresh();
    }

    async fetchAPI(endpoint, options = {}) {
        try {
            const response = await fetch(`${this.baseURL}${endpoint}`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error(`API Error for ${endpoint}:`, error);
            throw error;
        }
    }

    async loadStats() {
        try {
            const [services, apiStats, tasks, toolStats] = await Promise.all([
                this.fetchAPI('/api/services'),
                this.fetchAPI('/api/logs/stats'),
                this.fetchAPI('/api/ai-capabilities/tasks'),
                this.fetchAPI('/api/logs/mcp-tools?limit=1')
            ]);

            // 更新统计数据
            document.getElementById('connectedServices').textContent = 
                services.filter(s => s.status === 'connected').length;
            
            document.getElementById('totalAPICalls').textContent = 
                apiStats.totalCalls || 0;
            
            document.getElementById('activeTasks').textContent = 
                tasks.filter(t => t.status === 'running' || t.status === 'pending').length;
            
            document.getElementById('totalToolCalls').textContent = 
                apiStats.totalToolCalls || 0;

        } catch (error) {
            console.error('Failed to load stats:', error);
        }
    }

    async loadServices() {
        const content = document.getElementById('servicesContent');
        
        try {
            content.innerHTML = '<div class="loading">加载中...</div>';
            const services = await this.fetchAPI('/api/services');
            
            if (services.length === 0) {
                content.innerHTML = '<p>暂无连接的服务</p>';
                return;
            }

            const servicesHTML = services.map(service => `
                <div class="service-card">
                    <h4>${service.id}</h4>
                    <p><strong>名称:</strong> ${service.name || 'N/A'}</p>
                    <p><strong>版本:</strong> ${service.version || 'N/A'}</p>
                    <p><strong>状态:</strong> <span class="service-status status-${service.status}">${this.getStatusText(service.status)}</span></p>
                    <p><strong>工具数量:</strong> ${service.tools?.length || 0}</p>
                    <p><strong>资源数量:</strong> ${service.resources?.length || 0}</p>
                    ${service.tools && service.tools.length > 0 ? `
                        <div class="log-details">
                            <strong>可用工具:</strong>
                            <div class="json-viewer">${service.tools.map(tool => tool.name).join(', ')}</div>
                        </div>
                    ` : ''}
                </div>
            `).join('');

            content.innerHTML = `<div class="service-grid">${servicesHTML}</div>`;

        } catch (error) {
            content.innerHTML = `<div class="error">加载服务失败: ${error.message}</div>`;
        }
    }

    async loadTasks() {
        const content = document.getElementById('tasksContent');
        const typeFilter = document.getElementById('taskTypeFilter').value;
        const statusFilter = document.getElementById('taskStatusFilter').value;
        
        try {
            content.innerHTML = '<div class="loading">加载中...</div>';
            
            let url = '/api/ai-capabilities/tasks';
            const params = new URLSearchParams();
            if (typeFilter) params.append('type', typeFilter);
            if (statusFilter) params.append('status', statusFilter);
            if (params.toString()) url += '?' + params.toString();
            
            const tasks = await this.fetchAPI(url);
            
            if (tasks.length === 0) {
                content.innerHTML = '<p>暂无任务</p>';
                return;
            }

            const tasksHTML = tasks.map(task => `
                <div class="task-card">
                    <div class="task-header">
                        <span class="task-type">${this.getTaskTypeText(task.type)}</span>
                        <span class="task-status status-${task.status}">${this.getTaskStatusText(task.status)}</span>
                    </div>
                    <p><strong>任务ID:</strong> ${task.id}</p>
                    <p><strong>创建时间:</strong> ${new Date(task.createdAt).toLocaleString()}</p>
                    ${task.updatedAt ? `<p><strong>更新时间:</strong> ${new Date(task.updatedAt).toLocaleString()}</p>` : ''}
                    ${task.completedAt ? `<p><strong>完成时间:</strong> ${new Date(task.completedAt).toLocaleString()}</p>` : ''}
                    ${task.progress !== undefined ? `<p><strong>进度:</strong> ${task.progress}%</p>` : ''}
                    ${task.prompt ? `<p><strong>提示词:</strong> ${task.prompt.length > 100 ? task.prompt.substring(0, 100) + '...' : task.prompt}</p>` : ''}
                    ${task.filename ? `<p><strong>文件名:</strong> ${task.filename}</p>` : ''}
                    ${task.filePath ? `<p><strong>文件路径:</strong> <a href="${task.filePath}" target="_blank">${task.filePath}</a></p>` : ''}
                    ${task.error ? `<div class="error"><strong>错误:</strong> ${task.error}</div>` : ''}
                    
                    ${task.submissionInfo ? `
                        <div class="log-details expandable collapsed" onclick="this.classList.toggle('expanded'); this.classList.toggle('collapsed');">
                            <strong>📝 提交信息 (点击展开):</strong>
                            <div class="json-viewer">${JSON.stringify(task.submissionInfo, null, 2)}</div>
                        </div>
                    ` : ''}
                    
                    ${task.cloudRequestInfo ? `
                        <div class="log-details expandable collapsed" onclick="this.classList.toggle('expanded'); this.classList.toggle('collapsed');">
                            <strong>☁️ 云端请求信息 (点击展开):</strong>
                            <div class="json-viewer">${JSON.stringify(task.cloudRequestInfo, null, 2)}</div>
                        </div>
                    ` : ''}
                    
                    ${task.processSteps && task.processSteps.length > 0 ? `
                        <div class="log-details expandable collapsed" onclick="this.classList.toggle('expanded'); this.classList.toggle('collapsed');">
                            <strong>⚙️ 处理步骤 (点击展开):</strong>
                            <div class="process-steps">
                                ${task.processSteps.map(step => `
                                    <div class="process-step status-${step.status}">
                                        <strong>${step.step}:</strong> ${this.getTaskStatusText(step.status)}
                                        ${step.startTime ? `<br><small>开始: ${new Date(step.startTime).toLocaleString()}</small>` : ''}
                                        ${step.endTime ? `<br><small>结束: ${new Date(step.endTime).toLocaleString()}</small>` : ''}
                                        ${step.details ? `<br><small>详情: ${JSON.stringify(step.details)}</small>` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    
                    ${task.cloudResponseInfo ? `
                        <div class="log-details expandable collapsed" onclick="this.classList.toggle('expanded'); this.classList.toggle('collapsed');">
                            <strong>📡 云端响应信息 (点击展开):</strong>
                            <div class="json-viewer">${JSON.stringify(task.cloudResponseInfo, null, 2)}</div>
                        </div>
                    ` : ''}
                    
                    ${task.result ? `
                        <div class="log-details expandable collapsed" onclick="this.classList.toggle('expanded'); this.classList.toggle('collapsed');">
                            <strong>📋 结果 (点击展开):</strong>
                            <div class="json-viewer">${JSON.stringify(task.result, null, 2)}</div>
                        </div>
                    ` : ''}
                </div>
            `).join('');

            content.innerHTML = tasksHTML;

        } catch (error) {
            content.innerHTML = `<div class="error">加载任务失败: ${error.message}</div>`;
        }
    }

    async loadAPILogs() {
        const content = document.getElementById('logsContent');
        const limit = document.getElementById('logLimitFilter')?.value || 50;
        
        try {
            content.innerHTML = '<div class="loading">加载中...</div>';
            const logs = await this.fetchAPI(`/api/logs/api-calls?limit=${limit}`);
            
            if (logs.length === 0) {
                content.innerHTML = '<p>暂无API调用日志</p>';
                return;
            }

            const tableHTML = `
                <table class="log-table">
                    <thead>
                        <tr>
                            <th>时间</th>
                            <th>方法</th>
                            <th>路径</th>
                            <th>状态码</th>
                            <th>响应时间</th>
                            <th>IP地址</th>
                            <th>详情</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.map(log => `
                            <tr>
                                <td>${new Date(log.timestamp).toLocaleString()}</td>
                                <td>${log.method}</td>
                                <td>${log.path}</td>
                                <td><span class="status-${log.statusCode >= 400 ? 'failed' : 'completed'}">${log.statusCode}</span></td>
                                <td>${log.responseTime}ms</td>
                                <td>${log.ip}</td>
                                <td>
                                    ${log.requestBody || log.responseBody ? `
                                        <div class="expandable collapsed" onclick="this.classList.toggle('expanded'); this.classList.toggle('collapsed');">
                                            <span style="cursor: pointer; color: #007aff;">查看详情</span>
                                            <div class="json-viewer">
                                                ${log.requestBody ? `<strong>请求:</strong>\n${JSON.stringify(log.requestBody, null, 2)}\n\n` : ''}
                                                ${log.responseBody ? `<strong>响应:</strong>\n${JSON.stringify(log.responseBody, null, 2)}` : ''}
                                            </div>
                                        </div>
                                    ` : '-'}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;

            content.innerHTML = tableHTML;

        } catch (error) {
            content.innerHTML = `<div class="error">加载API日志失败: ${error.message}</div>`;
        }
    }

    async loadToolLogs() {
        const content = document.getElementById('toolsContent');
        const serviceFilter = document.getElementById('serviceFilter').value;
        const limit = document.getElementById('toolLimitFilter')?.value || 50;
        
        try {
            content.innerHTML = '<div class="loading">加载中...</div>';
            
            // 首先加载服务列表用于过滤器
            const services = await this.fetchAPI('/api/services');
            const serviceFilterEl = document.getElementById('serviceFilter');
            if (serviceFilterEl.children.length === 1) { // 只有默认选项
                services.forEach(service => {
                    const option = document.createElement('option');
                    option.value = service.id;
                    option.textContent = service.name || service.id;
                    serviceFilterEl.appendChild(option);
                });
            }
            
            let url = `/api/logs/mcp-tools?limit=${limit}`;
            if (serviceFilter) url += `&serviceId=${serviceFilter}`;
            
            const logs = await this.fetchAPI(url);
            
            if (logs.length === 0) {
                content.innerHTML = '<p>暂无工具调用日志</p>';
                return;
            }

            const tableHTML = `
                <table class="log-table">
                    <thead>
                        <tr>
                            <th>时间</th>
                            <th>服务</th>
                            <th>工具</th>
                            <th>状态</th>
                            <th>执行时间</th>
                            <th>详情</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.map(log => `
                            <tr>
                                <td>${new Date(log.timestamp).toLocaleString()}</td>
                                <td>${log.serviceId}</td>
                                <td>${log.toolName}</td>
                                <td><span class="status-${log.success ? 'completed' : 'failed'}">${log.success ? '成功' : '失败'}</span></td>
                                <td>${log.duration}ms</td>
                                <td>
                                    <div class="expandable collapsed" onclick="this.classList.toggle('expanded'); this.classList.toggle('collapsed');">
                                        <span style="cursor: pointer; color: #007aff;">查看详情</span>
                                        <div class="json-viewer">
                                            <strong>参数:</strong>\n${JSON.stringify(log.arguments, null, 2)}\n\n
                                            ${log.result ? `<strong>结果:</strong>\n${JSON.stringify(log.result, null, 2)}` : ''}
                                            ${log.error ? `<strong>错误:</strong>\n${log.error}` : ''}
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;

            content.innerHTML = tableHTML;

        } catch (error) {
            content.innerHTML = `<div class="error">加载工具调用日志失败: ${error.message}</div>`;
        }
    }

    showTab(tabName) {
        // 更新标签状态
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        
        event.target.classList.add('active');
        document.getElementById(tabName).classList.add('active');
        
        this.currentTab = tabName;
        
        // 加载对应的数据
        switch (tabName) {
            case 'services':
                this.loadServices();
                break;
            case 'tasks':
                this.loadTasks();
                break;
            case 'logs':
                this.loadAPILogs();
                break;
            case 'tools':
                this.loadToolLogs();
                break;
        }
    }

    startAutoRefresh() {
        // 每30秒自动刷新统计数据
        this.refreshInterval = setInterval(() => {
            this.loadStats();
        }, 30000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    getStatusText(status) {
        const statusMap = {
            'connected': '已连接',
            'disconnected': '已断开',
            'connecting': '连接中',
            'error': '错误'
        };
        return statusMap[status] || status;
    }

    getTaskTypeText(type) {
        const typeMap = {
            'text-to-image': '文生图',
            'image-to-image': '图生图',
            'edit-image': '编辑图像',
            'text-to-speech': '文生语音',
            'text-to-video': '文生视频',
            'image-to-video': '图生视频'
        };
        return typeMap[type] || type;
    }

    getTaskStatusText(status) {
        const statusMap = {
            'pending': '等待中',
            'running': '运行中',
            'completed': '已完成',
            'failed': '失败'
        };
        return statusMap[status] || status;
    }
}

// 全局函数供HTML调用
let dashboard;

function showTab(tabName) {
    dashboard.showTab(tabName);
}

function loadServices() {
    dashboard.loadServices();
}

function loadTasks() {
    dashboard.loadTasks();
}

function loadAPILogs() {
    dashboard.loadAPILogs();
}

function loadToolLogs() {
    dashboard.loadToolLogs();
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new Dashboard();
});

// 页面卸载时清理定时器
window.addEventListener('beforeunload', () => {
    if (dashboard) {
        dashboard.stopAutoRefresh();
    }
});