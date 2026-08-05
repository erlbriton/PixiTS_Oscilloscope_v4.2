document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.querySelector<HTMLElement>('.left-sidebar-column');
    const sidebarResizer = document.querySelector<HTMLElement>('.sidebar-resizer');
    const wrapper = document.querySelector<HTMLElement>('.panel-content-wrapper');
    const oscContainer = document.getElementById('osc-container');
    
    const MIN_RIGHT_PANEL_WIDTH = 610; 
    const OSCILLOSCOPE_WIDTH = 900;

    function enforceSidebarLimits(): void {
        if (!sidebar || !wrapper || !oscContainer) return;
        const containerRect = wrapper.getBoundingClientRect();
        const isOscHidden = oscContainer.classList.contains('hidden');
        const virtualOscOffset = isOscHidden ? OSCILLOSCOPE_WIDTH : 0;
        let maxSidebarWidth = containerRect.width - virtualOscOffset - MIN_RIGHT_PANEL_WIDTH;
        if (maxSidebarWidth < 40) maxSidebarWidth = 40;
        if (sidebar.offsetWidth > maxSidebarWidth) {
            sidebar.style.width = `${maxSidebarWidth}px`;
        }
    }

    // --- РЕСАЙЗЕРЫ ---
    if (sidebarResizer && sidebar && wrapper && oscContainer) {
        sidebarResizer.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            sidebarResizer.classList.add('active');
            document.body.classList.add('is-resizing');

            const doDragSidebar = (moveEvent: MouseEvent): void => {
                const containerRect = wrapper.getBoundingClientRect();
                const isOscHidden = oscContainer.classList.contains('hidden');
                const virtualOscOffset = isOscHidden ? OSCILLOSCOPE_WIDTH : 0;
                let maxSidebarWidth = containerRect.width - virtualOscOffset - MIN_RIGHT_PANEL_WIDTH;
                if (maxSidebarWidth < 40) maxSidebarWidth = 40;
                let newWidth = moveEvent.clientX - containerRect.left;
                if (newWidth < 40) newWidth = 40; 
                if (newWidth > maxSidebarWidth) newWidth = maxSidebarWidth;
                sidebar.style.width = `${newWidth}px`;
            };

            const stopDragSidebar = (): void => {
                sidebarResizer.classList.remove('active');
                document.body.classList.remove('is-resizing');
                window.removeEventListener('mousemove', doDragSidebar);
                window.removeEventListener('mouseup', stopDragSidebar);
            };

            window.addEventListener('mousemove', doDragSidebar);
            window.addEventListener('mouseup', stopDragSidebar);
        });
    }

    const table = document.querySelector<HTMLElement>('.modbus-grid');
    const subHeaders = document.querySelectorAll<HTMLElement>('.modbus-grid thead tr:last-child th');
    const cols = document.querySelectorAll<HTMLElement>('.modbus-grid colgroup col');

    if (table) {
        const internalIndices = [0, 1, 2, 4, 6]; 
        internalIndices.forEach(idx => {
            const th = subHeaders[idx];
            const nextCol = cols[idx + 1];
            const currCol = cols[idx];
            if (!th || !nextCol || !currCol) return;

            const resizer = document.createElement('div');
            resizer.className = 'table-resizer internal-resizer';
            th.appendChild(resizer);

            resizer.addEventListener('mousedown', (e: MouseEvent) => {
                e.preventDefault();
                resizer.classList.add('active');
                document.body.classList.add('is-resizing');

                const startX = e.clientX;
                const totalTableWidth = table.offsetWidth;
                const nextTh = subHeaders[idx + 1];
                if (!nextTh) return;

                const startWidthLeft = th.getBoundingClientRect().width;
                const startWidthRight = nextTh.getBoundingClientRect().width;

                const doDragInternal = (moveEvent: MouseEvent): void => {
                    let delta = moveEvent.clientX - startX;
                    if (startWidthLeft + delta < 40) delta = 40 - startWidthLeft;
                    if (startWidthRight - delta < 40) delta = startWidthRight - 40;
                    const pctLeft = ((startWidthLeft + delta) / totalTableWidth) * 100;
                    const pctRight = ((startWidthRight - delta) / totalTableWidth) * 100;
                    currCol.style.width = `${pctLeft}%`;
                    nextCol.style.width = `${pctRight}%`;
                };

                const stopDragInternal = (): void => {
                    resizer.classList.remove('active');
                    document.body.classList.remove('is-resizing');
                    window.removeEventListener('mousemove', doDragInternal);
                    window.removeEventListener('mouseup', stopDragInternal);
                };

                window.addEventListener('mousemove', doDragInternal);
                window.addEventListener('mouseup', stopDragInternal);
            });
        });
    }

    enforceSidebarLimits();
});
