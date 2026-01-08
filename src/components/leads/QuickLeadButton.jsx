import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import QuickLeadModal from './QuickLeadModal';

export default function QuickLeadButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 left-6 z-50 h-14 w-14 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-lg hover:shadow-xl transition-all duration-300"
        size="icon"
      >
        <Plus className="w-6 h-6 text-white" />
      </Button>
      
      <QuickLeadModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}