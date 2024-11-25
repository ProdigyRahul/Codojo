"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import useProject from "@/hooks/use-project";
import { DialogTitle } from "@radix-ui/react-dialog";
import { readStreamableValue } from "ai/rsc";
import Image from "next/image";
import React from "react";
import { askQuestion } from "./actions";

const AskQuestionCard = () => {
  const { project } = useProject();
  const [open, setOpen] = React.useState(false);
  const [question, setQuestion] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [filesReferences, setFilesReferences] = React.useState<
    { fileName: string; sourceCode: string; summary: string }[]
  >([]);
  const [answer, setAnswer] = React.useState("");

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    if (!project?.id) {
      return alert("No Project has been specified");
    }
    setLoading(true);
    e.preventDefault();
    setOpen(true);

    const { output, filesReferences } = await askQuestion(question, project.id);
    setFilesReferences(filesReferences);
    for await (const delta of readStreamableValue(output)) {
      if (delta) {
        setAnswer((ans) => ans + delta);
      }
    }
    setLoading(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Image src="/logo.png" alt="logo" width={40} height={40} />
            </DialogTitle>
          </DialogHeader>
          {answer}
          {filesReferences.map((file) => {
            return <span>{file.fileName}</span>;
          })}
        </DialogContent>
      </Dialog>
      <Card className="relative col-span-3">
        <CardHeader>
          <CardTitle>Ask a question</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit}>
            <Textarea
              placeholder="Which file should i edit to change the home page?"
              onChange={(e) => setQuestion(e.target.value)}
            />
            <div className="h-4"></div>
            <Button type="submit">Ask Codojo!</Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
};

export default AskQuestionCard;
