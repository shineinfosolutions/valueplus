"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface AutocompleteSearchProps {
  data: any[];
  searchKeys: string[];
  displayKey: string;
  subDisplayKey?: string;
  placeholder?: string;
  value: string;
  onSearchChange: (value: string) => void;
  className?: string;
  inputClassName?: string;
}

export function AutocompleteSearch({
  data,
  searchKeys,
  displayKey,
  subDisplayKey,
  placeholder = "Search...",
  value,
  onSearchChange,
  className = "w-72",
  inputClassName = "",
}: AutocompleteSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value || value.trim() === "") {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    const searchTerm = value.toLowerCase();
    
    // Filter logic based on provided searchKeys
    const matches = data.filter((item) => {
      return searchKeys.some((key) => {
        const val = item[key];
        if (typeof val === "string") {
          return val.toLowerCase().includes(searchTerm);
        }
        if (typeof val === "number") {
          return val.toString().includes(searchTerm);
        }
        return false;
      });
    });

    setSuggestions(matches.slice(0, 8));
    setIsOpen(matches.length > 0);
  }, [value, data, searchKeys]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (item: any) => {
    // Populate the input with the primary display key value
    const selectedText = String(item[displayKey]);
    onSearchChange(selectedText);
    setIsOpen(false);
  };

  const highlightText = (text: string, highlight: string) => {
    if (!highlight.trim()) return text;
    const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
    return (
      <>
        {parts.map((part, i) => 
          part.toLowerCase() === highlight.toLowerCase() ? (
            <span key={i} className="bg-yellow-200 text-yellow-900 font-semibold rounded-sm px-0.5">{part}</span>
          ) : (
            part
          )
        )}
      </>
    );
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onSearchChange(e.target.value);
          if (!isOpen && e.target.value) setIsOpen(true);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setIsOpen(true);
        }}
        className={`pl-9 relative z-0 transition-shadow focus-visible:ring-[#3F63AD]/30 focus-visible:border-[#3F63AD] ${inputClassName}`}
      />
      
      {isOpen && (
        <div className="absolute top-full mt-1.5 w-full bg-white border border-slate-200 rounded-lg shadow-xl shadow-slate-200/50 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <ul className="max-h-[300px] overflow-y-auto py-1 scrollbar-thin scrollbar-thumb-slate-200">
            {suggestions.map((item, index) => (
              <li
                key={item._id || item.id || index}
                onClick={() => handleSelect(item)}
                className="px-3 py-2 cursor-pointer hover:bg-slate-50 border-b border-slate-50 last:border-0 transition-colors flex flex-col gap-0.5 group"
              >
                <span className="text-sm font-medium text-slate-700 group-hover:text-[#3F63AD] transition-colors line-clamp-1">
                  {highlightText(String(item[displayKey] || ""), value)}
                </span>
                {subDisplayKey && item[subDisplayKey] && (
                  <span className="text-xs text-slate-500 line-clamp-1">
                    {highlightText(String(item[subDisplayKey] || ""), value)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
