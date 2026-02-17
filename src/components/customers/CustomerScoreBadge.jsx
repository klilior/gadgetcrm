import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Star, Trophy, Medal, Award, Sparkles } from 'lucide-react';

const tierConfig = {
    'VIP':    { icon: Trophy,   bg: 'bg-gradient-to-r from-purple-600 to-indigo-600', text: 'text-white', ring: 'ring-2 ring-purple-300' },
    'זהב':   { icon: Star,     bg: 'bg-gradient-to-r from-yellow-500 to-amber-500', text: 'text-white', ring: 'ring-2 ring-yellow-300' },
    'כסף':   { icon: Medal,    bg: 'bg-gradient-to-r from-gray-400 to-slate-500', text: 'text-white', ring: 'ring-2 ring-gray-300' },
    'ברונזה': { icon: Award,    bg: 'bg-gradient-to-r from-orange-400 to-amber-600', text: 'text-white', ring: 'ring-2 ring-orange-200' },
    'חדש':   { icon: Sparkles, bg: 'bg-gradient-to-r from-blue-400 to-cyan-500', text: 'text-white', ring: '' },
};

export default function CustomerScoreBadge({ score, tier, size = 'md' }) {
    const config = tierConfig[tier] || tierConfig['חדש'];
    const Icon = config.icon;

    if (size === 'sm') {
        return (
            <Badge className={`${config.bg} ${config.text} ${config.ring} px-2 py-0.5 text-xs gap-1`}>
                <Icon className="w-3 h-3" />
                {tier} ({score})
            </Badge>
        );
    }

    return (
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${config.bg} ${config.text} ${config.ring} shadow-lg`}>
            <Icon className="w-4 h-4" />
            <span className="font-bold text-sm">{tier}</span>
            <span className="text-xs opacity-80">({score}/100)</span>
        </div>
    );
}