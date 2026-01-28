import React, { useState } from 'react';
import { StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import QuickLeadModal from './QuickLeadModal';

export default function QuickLeadButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 left-6 z-[9998] h-auto px-4 py-3 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2"
      >
        <StickyNote className="w-5 h-5 text-white" />
        <span className="text-white font-medium">פתק מהיר</span>
      </Button>
      
      <QuickLeadModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}