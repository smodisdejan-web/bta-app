'use client'

import React, { ReactNode, useEffect, useRef, useState, createContext, useContext } from 'react';

interface PopoverContextType {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
}

const PopoverContext = createContext<PopoverContextType | null>(null);

interface PopoverProps {
    children: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

export function Popover({ children, open, onOpenChange }: PopoverProps) {
    const [isOpen, setIsOpen] = useState(open || false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open !== undefined) {
            setIsOpen(open);
        }
    }, [open]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                onOpenChange?.(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen, onOpenChange]);

    const handleOpenChange = (newOpen: boolean) => {
        setIsOpen(newOpen);
        onOpenChange?.(newOpen);
    };

    return (
        <PopoverContext.Provider value={{ isOpen, setIsOpen: handleOpenChange }}>
            <div className="relative inline-block w-full" ref={containerRef}>
                {children}
            </div>
        </PopoverContext.Provider>
    );
}

interface PopoverTriggerProps {
    children: ReactNode;
    asChild?: boolean;
}

export function PopoverTrigger({ children, asChild }: PopoverTriggerProps) {
    const context = useContext(PopoverContext);
    
    if (!context) {
        throw new Error('PopoverTrigger must be used within Popover');
    }

    const handleClick = () => {
        context.setIsOpen(!context.isOpen);
    };

    if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children, { onClick: handleClick } as any);
    }

    return <div onClick={handleClick}>{children}</div>;
}

interface PopoverContentProps {
    children: ReactNode;
    className?: string;
    align?: 'start' | 'end' | 'center';
}

export function PopoverContent({ children, className = '', align = 'start' }: PopoverContentProps) {
    const context = useContext(PopoverContext);
    
    if (!context) {
        throw new Error('PopoverContent must be used within Popover');
    }

    if (!context.isOpen) {
        return null;
    }

    const alignClass = align === 'end' ? 'right-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0';
    
    return (
        <div className={`absolute z-50 mt-1 bg-background border rounded-md shadow-md ${alignClass} ${className}`}>
            {children}
        </div>
    );
} 